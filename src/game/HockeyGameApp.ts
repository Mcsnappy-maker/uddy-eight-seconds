import {
  AbstractEngine,
  Mesh,
  MeshBuilder,
  Scene,
  SceneInstrumentation,
} from '@babylonjs/core';
import {
  ControlScheme,
  DifficultyPreset,
  FIH,
} from '../rules/RulesConfig';
import { ShootoutAdjudicator } from '../rules/ShootoutAdjudicator';
import { PhysicsWorld } from '../simulation/PhysicsWorld';
import {
  EngineManager,
  LightingPreset,
  QualityTier,
  RendererBackend,
} from '../rendering/EngineManager';
import { createMaterialPalette, MaterialPalette } from '../rendering/PBRMaterials';
import {
  AttackerVariant,
  AttackerVisualRig,
  KeeperVisualRig,
} from '../rendering/AthleteModels';
import { VenueScene } from '../rendering/VenueScene';
import { AttackerController, AttackerInputState } from '../entities/AttackerController';
import { GoalkeeperAI } from '../entities/GoalkeeperAI';
import { CameraViewMode, GameplayCamera } from '../camera/GameplayCamera';
import { SoundManager } from '../audio/SoundManager';
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { EncounterHUD } from '../ui/EncounterHUD';

export interface BenchmarkSample {
  backend: RendererBackend;
  gpuAdapter: string;
  userAgent: string;
  resolution: { width: number; height: number; dpr: number; hardwareScaling: number };
  qualityTier: QualityTier;
  lightingPreset: LightingPreset;
  frameCount: number;
  avgFps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  stallsOver50ms: number;
  activeRenderWorkMs: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  characterAssetStats: {
    attacker: { meshes: number; vertices: number; bones: number };
    keeper: { meshes: number; vertices: number; bones: number };
  };
  jsHeapMB: number | null;
}

export class HockeyGameApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly hud: EncounterHUD;
  private engine!: AbstractEngine;
  private scene!: Scene;
  private backend: RendererBackend = 'webgl2';
  private gpuAdapterInfo = 'Unknown';
  private palette!: MaterialPalette;
  private venue!: VenueScene;
  private attackerRig!: AttackerVisualRig;
  private keeperRig!: KeeperVisualRig;
  private ballMesh!: Mesh;
  private ballHaloMesh!: Mesh;
  private aimReticleMesh!: Mesh;
  private cameraCtrl!: GameplayCamera;

  private readonly physics = new PhysicsWorld();
  private readonly adjudicator = new ShootoutAdjudicator();
  private readonly attackerCtrl = new AttackerController();
  private readonly keeperAI = new GoalkeeperAI();
  private readonly replay = new ReplayRecorder();
  private readonly sound: SoundManager;

  private difficulty: DifficultyPreset = 'club_challenge';
  private controlScheme: ControlScheme = 'standard';
  private qualityTier: QualityTier = 'showcase';
  private lightingPreset: LightingPreset = 'floodlit';
  private ballHaloEnabled = false;
  private reducedMotion = false;

  private attemptId = 0;
  private simAccumulator = 0;
  private totalTime = 0;
  private isReplaying = false;
  private replayTime = 0;

  // Input tracking
  private readonly keysDown = new Set<string>();
  private aimNormX = 0;
  private aimNormY = 0.35;
  private mouseLeftDown = false;
  private mouseRightDown = false;
  private releaseShotQueued = false;
  private feintQueued = false;
  private liftedModeToggle = false;
  private syntheticScriptInput: Partial<AttackerInputState> | null = null;

  // Frame-time ring buffer for live telemetry & automated benchmark
  private readonly recentFrameMs: number[] = [];
  private readonly recentRenderWorkMs: number[] = [];
  private sceneInstrumentation!: SceneInstrumentation;
  private lastFrameTimestamp = performance.now();
  private lastHudTelemetryMs = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.sound = new SoundManager((caption) => this.hud.showCaption(caption));
    this.hud = new EncounterHUD(uiRoot, {
      onStartAttempt: () => this.startAttempt(),
      onRetryAttempt: () => this.resetToReadyAndStart(true),
      onToggleReplay: () => this.toggleReplay(),
      onDifficultyChange: (d) => {
        this.difficulty = d;
      },
      onControlSchemeChange: (c) => {
        this.controlScheme = c;
      },
      onVariantChange: (v: AttackerVariant) => {
        this.attackerRig.setVariant(v);
      },
      onCameraModeChange: (m: CameraViewMode) => {
        this.cameraCtrl.setMode(m);
      },
      onLightingChange: (l: LightingPreset) => {
        this.lightingPreset = l;
        this.venue.applyAtmosphere(this.lightingPreset, this.qualityTier);
      },
      onQualityChange: (q: QualityTier) => {
        this.qualityTier = q;
        this.venue.applyAtmosphere(this.lightingPreset, this.qualityTier);
      },
      onRendererSwitch: (targetBackend) => {
        const url = new URL(window.location.href);
        url.searchParams.set('renderer', targetBackend);
        window.location.href = url.toString();
      },
      onToggleBallHalo: (enabled) => {
        this.ballHaloEnabled = enabled;
        if (this.ballHaloMesh) this.ballHaloMesh.isVisible = enabled;
      },
      onToggleQuietEvent: (quiet) => {
        this.sound.setVolumes({ quietEventPreset: quiet });
      },
      onToggleReducedMotion: (reduced) => {
        this.reducedMotion = reduced;
      },
      onToggleLargeText: () => {
        // Handled via HUD class toggle
      },
    });
  }

  public async init(): Promise<void> {
    const initRes = await EngineManager.createEngine(this.canvas);
    this.engine = initRes.engine;
    this.backend = initRes.backend;
    this.gpuAdapterInfo = initRes.gpuAdapterInfo;
    this.hud.syncBackendSelection(this.backend);

    this.scene = new Scene(this.engine);
    this.sceneInstrumentation = new SceneInstrumentation(this.scene);
    this.sceneInstrumentation.captureFrameTime = true;

    this.palette = createMaterialPalette(this.scene);
    this.venue = new VenueScene(this.scene, this.palette);
    this.cameraCtrl = new GameplayCamera(this.scene);

    this.attackerRig = new AttackerVisualRig(this.palette, this.scene);
    this.keeperRig = new KeeperVisualRig(this.palette, this.scene);
    await Promise.all([
      this.attackerRig.loadAsync(this.scene, this.venue.shadowGenerator ?? undefined),
      this.keeperRig.loadAsync(this.scene, this.venue.shadowGenerator ?? undefined),
    ]);

    this.ballMesh = MeshBuilder.CreateSphere(
      'hockey_ball',
      { diameter: FIH.BALL_RADIUS * 2, segments: 18 },
      this.scene,
    );
    this.ballMesh.material = this.palette.ballChalk;
    this.ballMesh.receiveShadows = true;
    this.venue.shadowGenerator?.addShadowCaster(this.ballMesh, false);

    this.ballHaloMesh = MeshBuilder.CreateTorus(
      'ball_accessibility_halo',
      { diameter: 0.36, thickness: 0.025, tessellation: 24 },
      this.scene,
    );
    this.ballHaloMesh.material = this.palette.ballHighlightHalo;
    this.ballHaloMesh.isVisible = this.ballHaloEnabled;

    this.aimReticleMesh = MeshBuilder.CreateTorus(
      'aim_reticle',
      { diameter: 0.28, thickness: 0.022, tessellation: 20 },
      this.scene,
    );
    this.aimReticleMesh.rotation.x = Math.PI * 0.5;
    this.aimReticleMesh.material = this.palette.ballHighlightHalo;
    this.aimReticleMesh.isVisible = false;

    this.bindInputs();
    this.prepareReadyState();
    this.cameraCtrl.update(1, this.attackerCtrl.pos, this.keeperAI.pos, this.physics.ball.pos, true);

    window.addEventListener('resize', () => this.engine.resize());
    this.installDebugBridge();

    this.lastFrameTimestamp = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const rawDt = Math.max(0.0001, (now - this.lastFrameTimestamp) / 1000);
      const frameMs = rawDt * 1000;
      this.lastFrameTimestamp = now;
      this.tick(Math.min(0.1, rawDt), frameMs, now);
      this.scene.render();
    });
  }

  private prepareReadyState(): void {
    this.isReplaying = false;
    this.replay.clear();
    this.attemptId = this.adjudicator.prepareNewAttempt();
    this.physics.resetBall({ x: 0, y: FIH.BALL_RADIUS, z: FIH.LINE_23M_DISTANCE });
    this.attackerCtrl.reset();
    this.keeperAI.reset();
    this.syncVisualRigTransforms();
    this.cameraCtrl?.update(1, this.attackerCtrl.pos, this.keeperAI.pos, this.physics.ball.pos, true);
    this.updateHUD();
  }

  public startAttempt(): void {
    this.sound.unlock();
    if (this.adjudicator.getPhase() !== 'Ready') {
      this.prepareReadyState();
    }
    this.adjudicator.startWhistle(this.attemptId);
    this.sound.playWhistle(false);
    this.updateHUD();
  }

  public resetToReadyAndStart(autoStart: boolean): void {
    this.sound.unlock();
    this.prepareReadyState();
    if (autoStart) {
      this.startAttempt();
    }
  }

  private toggleReplay(): void {
    if (this.isReplaying) {
      this.isReplaying = false;
      this.updateHUD();
      return;
    }
    if (this.replay.getFrameCount() > 5) {
      this.isReplaying = true;
      this.replayTime = 0;
      this.updateHUD();
    }
  }

  private gatherInput(): AttackerInputState {
    if (this.syntheticScriptInput) {
      return {
        moveX: this.syntheticScriptInput.moveX ?? 0,
        moveZ: this.syntheticScriptInput.moveZ ?? 0,
        sprint: this.syntheticScriptInput.sprint ?? false,
        closeControl: this.syntheticScriptInput.closeControl ?? false,
        feintTriggered: this.syntheticScriptInput.feintTriggered ?? false,
        aimNormX: this.syntheticScriptInput.aimNormX ?? this.aimNormX,
        aimNormY: this.syntheticScriptInput.aimNormY ?? this.aimNormY,
        chargingShot: this.syntheticScriptInput.chargingShot ?? false,
        liftedShotMode: this.syntheticScriptInput.liftedShotMode ?? false,
        releaseShotTriggered: this.syntheticScriptInput.releaseShotTriggered ?? false,
      };
    }

    let moveX = 0;
    let moveZ = 0;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) moveX -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) moveX += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) moveZ += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) moveZ -= 1;

    let gpCharge = false;
    let gpLift = false;
    let gpFeint = false;
    let gpSprint = false;
    let gpClose = false;

    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gps[0];
    if (gp) {
      if (Math.abs(gp.axes[0] ?? 0) > 0.16) moveX += gp.axes[0];
      if (Math.abs(gp.axes[1] ?? 0) > 0.16) moveZ -= gp.axes[1];
      if (Math.abs(gp.axes[2] ?? 0) > 0.16) this.aimNormX = Math.max(-1, Math.min(1, gp.axes[2]));
      if (Math.abs(gp.axes[3] ?? 0) > 0.16) this.aimNormY = Math.max(0, Math.min(1, 0.5 - gp.axes[3] * 0.5));
      gpCharge = (gp.buttons[7]?.value ?? 0) > 0.3 || Boolean(gp.buttons[0]?.pressed);
      gpClose = (gp.buttons[6]?.value ?? 0) > 0.3 || Boolean(gp.buttons[4]?.pressed);
      gpFeint = Boolean(gp.buttons[1]?.pressed);
      gpLift = Boolean(gp.buttons[2]?.pressed);
      gpSprint = Boolean(gp.buttons[5]?.pressed);
      if (gp.buttons[3]?.pressed || gp.buttons[9]?.pressed) {
        if (this.adjudicator.getPhase() === 'Ready') this.startAttempt();
      }
    }

    const feintTriggered = this.feintQueued || gpFeint;
    this.feintQueued = false;

    const releaseShotTriggered = this.releaseShotQueued;
    this.releaseShotQueued = false;

    const simplifiedTrigger = this.controlScheme === 'simplified' && this.keysDown.has('Space');
    const chargingShot = this.mouseLeftDown || this.mouseRightDown || gpCharge || simplifiedTrigger;
    const liftedShotMode = this.mouseRightDown || this.liftedModeToggle || this.keysDown.has('KeyF') || gpLift;

    return {
      moveX: Math.max(-1, Math.min(1, moveX)),
      moveZ: Math.max(-1, Math.min(1, moveZ)),
      sprint: this.keysDown.has('ShiftLeft') || gpSprint,
      closeControl: this.keysDown.has('ControlLeft') || gpClose,
      feintTriggered,
      aimNormX: this.aimNormX,
      aimNormY: this.aimNormY,
      chargingShot,
      liftedShotMode,
      releaseShotTriggered,
    };
  }

  private tick(dt: number, frameMs: number, nowMs: number): void {
    this.totalTime += dt;
    this.recentFrameMs.push(frameMs);
    if (this.recentFrameMs.length > 480) {
      this.recentFrameMs.shift();
    }
    const workMs = this.sceneInstrumentation.frameTimeCounter.lastSecAverage || this.sceneInstrumentation.frameTimeCounter.current;
    if (workMs > 0) {
      this.recentRenderWorkMs.push(workMs);
      if (this.recentRenderWorkMs.length > 480) {
        this.recentRenderWorkMs.shift();
      }
    }

    if (nowMs - this.lastHudTelemetryMs > 300) {
      this.lastHudTelemetryMs = nowMs;
      const fps = this.engine.getFps();
      this.hud.setTelemetry(`${this.backend.toUpperCase()} · ${Math.round(fps)} fps · ${this.qualityTier}`);
    }

    const input = this.gatherInput();
    if (this.isReplaying) {
      this.replayTime += dt * 0.65; // Crisp 0.65x slow-motion review
      if (this.replayTime > this.replay.getDuration() + 0.8) {
        this.replayTime = 0;
      }
      const sample = this.replay.sampleAt(this.replayTime);
      if (sample) {
        this.physics.ball.pos = { ...sample.ballPos };
        this.attackerCtrl.pos = { ...sample.attackerPos };
        this.attackerCtrl.yaw = sample.attackerYaw;
        this.keeperAI.pos = { ...sample.keeperPos };
        this.keeperAI.yaw = sample.keeperYaw;
        this.attackerRig.updateAnimation(sample.timeSeconds * 6, sample.attackerSpeed, 0, sample.attackerSwing, 0);
        this.keeperRig.updatePose(sample.keeperPose as never, sample.keeperSaveProgress, sample.timeSeconds * 4);
      }
      this.syncVisualRigTransforms();
      this.venue.updateVisualEffects(dt, this.totalTime);
      this.cameraCtrl.update(dt, this.attackerCtrl.pos, this.keeperAI.pos, this.physics.ball.pos);
      this.updateHUD();
      return;
    }

    const phase = this.adjudicator.getPhase();
    const isActive = phase === 'Active';

    this.simAccumulator += dt;
    while (this.simAccumulator >= FIH.SIM_FIXED_DT - 1e-9) {
      this.simAccumulator -= FIH.SIM_FIXED_DT;

      if (isActive && this.adjudicator.getPhase() === 'Active') {
        this.attackerCtrl.step(
          FIH.SIM_FIXED_DT,
          true,
          this.controlScheme,
          input,
          this.physics.ball.pos,
          this.physics.ball.vel,
          this.keeperAI.pos,
          (bPos) => {
            this.adjudicator.notifyAttackerTouch(this.attemptId, bPos, false);
          },
          (cmd) => {
            this.sound.playStickStrike(cmd.power01, cmd.isLifted);
            this.venue.burstTurfSpray(this.physics.ball.pos, 16);
          },
        );

        this.keeperAI.step(
          FIH.SIM_FIXED_DT,
          true,
          this.difficulty,
          this.physics.ball.pos,
          this.physics.ball.vel,
          this.attackerCtrl.charge01,
          this.attackerCtrl.getFeintLateral(),
        );

        // Update animated keeper pose & export world equipment OBBs to physics
        this.keeperRig.root.position.set(this.keeperAI.pos.x, 0, this.keeperAI.pos.z);
        this.keeperRig.root.rotation.y = this.keeperAI.yaw;
        this.keeperRig.updatePose(
          this.keeperAI.poseMode,
          this.keeperAI.saveProgress01,
          this.keeperAI.lateralPhase,
        );
        this.physics.setDynamicColliders(
          this.keeperRig.getWorldEquipmentColliders(this.keeperAI.vel),
        );

        const stepOut = this.physics.step(FIH.SIM_FIXED_DT);
        for (const hit of stepOut.hits) {
          if (hit.tag === 'post') {
            this.adjudicator.notifyPostHit(this.attemptId);
            this.sound.playPostClang();
          } else if (hit.tag === 'backboard') {
            this.adjudicator.notifyBackboardHit(this.attemptId);
            this.sound.playBackboardBoom();
          } else if (hit.tag.startsWith('keeper_')) {
            this.adjudicator.notifyKeeperSave(this.attemptId);
            this.sound.playKeeperPadSave();
            this.venue.burstTurfSpray(hit.point, 12);
          }
        }
        if (stepOut.hitNet && stepOut.netImpactPoint) {
          this.venue.triggerNetRipple(stepOut.netImpactPoint);
        }

        const result = this.adjudicator.step(
          this.attemptId,
          FIH.SIM_FIXED_DT,
          stepOut.prevPos,
          stepOut.currPos,
          stepOut.speedMps,
        );

        this.replay.record({
          timeSeconds: this.adjudicator.getElapsedSeconds(),
          ballPos: stepOut.currPos,
          attackerPos: this.attackerCtrl.pos,
          attackerYaw: this.attackerCtrl.yaw,
          attackerSpeed: this.attackerCtrl.getSpeedMps(),
          attackerSwing: this.attackerCtrl.getSwing01(),
          keeperPos: this.keeperAI.pos,
          keeperYaw: this.keeperAI.yaw,
          keeperPose: this.keeperAI.poseMode,
          keeperSaveProgress: this.keeperAI.saveProgress01,
        });

        if (result) {
          this.sound.playWhistle(true);
          this.sound.playCrowdReaction(result.isGoal);
          break;
        }
      }
    }

    // Update audio footsteps & visual animation state
    if (isActive) {
      this.sound.playTurfFootstep(nowMs, this.attackerCtrl.getSpeedMps());
    }

    this.attackerRig.updateAnimation(
      this.attackerCtrl.walkPhase,
      this.attackerCtrl.getSpeedMps(),
      this.attackerCtrl.charge01,
      this.attackerCtrl.getSwing01(),
      this.attackerCtrl.getFeintLateral(),
    );
    this.keeperRig.updatePose(
      this.keeperAI.poseMode,
      this.keeperAI.saveProgress01,
      this.keeperAI.lateralPhase,
    );

    this.syncVisualRigTransforms();
    this.updateAimReticle(input);
    this.venue.updateVisualEffects(dt, this.totalTime);
    this.cameraCtrl.update(
      this.reducedMotion ? Math.max(dt, 0.25) : dt,
      this.attackerCtrl.pos,
      this.keeperAI.pos,
      this.physics.ball.pos,
    );
    this.updateHUD();
  }

  private syncVisualRigTransforms(): void {
    this.attackerRig.root.position.set(this.attackerCtrl.pos.x, 0, this.attackerCtrl.pos.z);
    this.attackerRig.root.rotation.y = this.attackerCtrl.yaw;

    this.keeperRig.root.position.set(this.keeperAI.pos.x, 0, this.keeperAI.pos.z);
    this.keeperRig.root.rotation.y = this.keeperAI.yaw;

    const b = this.physics.ball.pos;
    this.ballMesh.position.set(b.x, b.y, b.z);
    this.ballHaloMesh.position.set(b.x, 0.015, b.z);
  }

  private updateAimReticle(input: AttackerInputState): void {
    const active = this.adjudicator.getPhase() === 'Active' && !this.isReplaying;
    this.aimReticleMesh.isVisible = active && (input.chargingShot || this.attackerCtrl.hasPossession);
    if (this.aimReticleMesh.isVisible) {
      const aimPt = this.attackerCtrl.getAimGoalPoint(
        input.aimNormX,
        input.aimNormY,
        input.liftedShotMode,
      );
      this.aimReticleMesh.position.set(aimPt.x, aimPt.y, 0.03);
    }
  }

  private updateHUD(): void {
    this.hud.updateState({
      phase: this.adjudicator.getPhase(),
      remainingSeconds: this.adjudicator.getRemainingSeconds(),
      hasValidCircleTouch: this.adjudicator.hasValidCircleTouch(),
      charge01: this.attackerCtrl.charge01,
      isLiftedMode: this.mouseRightDown || this.liftedModeToggle || this.keysDown.has('KeyF'),
      isReplaying: this.isReplaying,
      lastResult: this.adjudicator.getLastResult(),
    });
  }

  private bindInputs(): void {
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.code);
      if (e.code === 'Enter' && this.adjudicator.getPhase() === 'Ready') {
        this.startAttempt();
      } else if (e.code === 'KeyR') {
        if (this.isReplaying) {
          this.isReplaying = false;
        }
        this.resetToReadyAndStart(true);
      } else if (e.code === 'Space' && this.controlScheme === 'standard') {
        e.preventDefault();
        this.feintQueued = true;
      } else if (e.code === 'KeyL') {
        this.liftedModeToggle = !this.liftedModeToggle;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
      if (e.code === 'Space' && this.controlScheme === 'simplified') {
        this.releaseShotQueued = true;
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ny = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
      this.aimNormX = Math.max(-1, Math.min(1, nx * 1.35));
      this.aimNormY = Math.max(0, Math.min(1, ny * 1.15));
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.sound.unlock();
      if (this.adjudicator.getPhase() === 'Ready') {
        this.startAttempt();
        return;
      }
      if (e.button === 0) this.mouseLeftDown = true;
      if (e.button === 2) this.mouseRightDown = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouseLeftDown) {
        this.mouseLeftDown = false;
        this.releaseShotQueued = true;
      }
      if (e.button === 2 && this.mouseRightDown) {
        this.mouseRightDown = false;
        this.releaseShotQueued = true;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private installDebugBridge(): void {
    (window as unknown as { __UDDY_DEBUG__: unknown }).__UDDY_DEBUG__ = {
      getBackend: () => this.backend,
      getAdapterInfo: () => this.gpuAdapterInfo,
      getPhase: () => this.adjudicator.getPhase(),
      getAttemptId: () => this.adjudicator.getAttemptId(),
      getLastResult: () => this.adjudicator.getLastResult(),
      getBallPos: () => ({ ...this.physics.ball.pos }),
      getAttackerPos: () => ({ ...this.attackerCtrl.pos }),
      getKeeperPos: () => ({ ...this.keeperAI.pos }),
      startAttempt: () => this.startAttempt(),
      retryAttempt: () => this.resetToReadyAndStart(true),
      setCameraMode: (m: CameraViewMode) => {
        this.cameraCtrl.setMode(m);
        this.cameraCtrl.update(1, this.attackerCtrl.pos, this.keeperAI.pos, this.physics.ball.pos, true);
        this.hud.syncDropdowns({ camera: m });
      },
      setLighting: (l: LightingPreset) => {
        this.lightingPreset = l;
        this.venue.applyAtmosphere(l, this.qualityTier);
        this.hud.syncDropdowns({ lighting: l });
      },
      setQuality: (q: QualityTier) => {
        this.qualityTier = q;
        this.venue.applyAtmosphere(this.lightingPreset, q);
        this.hud.syncDropdowns({ quality: q });
      },
      setDifficulty: (d: DifficultyPreset) => {
        this.difficulty = d;
      },
      setAttackerVariant: (v: AttackerVariant) => {
        this.attackerRig.setVariant(v);
      },
      setBallHalo: (enabled: boolean) => {
        this.ballHaloEnabled = enabled;
        this.ballHaloMesh.isVisible = enabled;
      },
      setSyntheticInput: (input: Partial<AttackerInputState> | null) => {
        this.syntheticScriptInput = input;
      },
      resetFrameStats: () => {
        this.recentFrameMs.length = 0;
        this.recentRenderWorkMs.length = 0;
      },
      getBenchmarkSummary: (): BenchmarkSample => {
        const sorted = [...this.recentFrameMs].sort((a, b) => a - b);
        const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
        const avgMs = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 16.67;

        const sortedWork = [...this.recentRenderWorkMs].sort((a, b) => a - b);
        const avgWork = sortedWork.length ? sortedWork.reduce((a, b) => a + b, 0) / sortedWork.length : 0;

        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          backend: this.backend,
          gpuAdapter: this.gpuAdapterInfo,
          userAgent: navigator.userAgent,
          resolution: {
            width: this.engine.getRenderWidth(),
            height: this.engine.getRenderHeight(),
            dpr: window.devicePixelRatio || 1,
            hardwareScaling: this.engine.getHardwareScalingLevel(),
          },
          qualityTier: this.qualityTier,
          lightingPreset: this.lightingPreset,
          frameCount: sorted.length,
          avgFps: Number((1000 / Math.max(0.1, avgMs)).toFixed(2)),
          p50FrameMs: Number(pct(sorted, 0.5).toFixed(2)),
          p95FrameMs: Number(pct(sorted, 0.95).toFixed(2)),
          p99FrameMs: Number(pct(sorted, 0.99).toFixed(2)),
          maxFrameMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
          stallsOver50ms: sorted.filter((ms) => ms > 50).length,
          activeRenderWorkMs: {
            avg: Number(avgWork.toFixed(2)),
            p50: Number(pct(sortedWork, 0.5).toFixed(2)),
            p95: Number(pct(sortedWork, 0.95).toFixed(2)),
            p99: Number(pct(sortedWork, 0.99).toFixed(2)),
          },
          characterAssetStats: {
            attacker: this.attackerRig.getTriangleStats(),
            keeper: this.keeperRig.getTriangleStats(),
          },
          jsHeapMB: mem ? Number((mem.usedJSHeapSize / (1024 * 1024)).toFixed(2)) : null,
        };
      },
    };
  }
}
