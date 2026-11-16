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
import {
  EncounterHUD,
  FreePlayStats,
  GameMode,
  PracticeSpot,
} from '../ui/EncounterHUD';
import type { PartnerLogoConfig } from '../config/PartnerLogosConfig';

export type { FreePlayStats, GameMode, PracticeSpot };

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
  private gameMode: GameMode = 'free_play';
  private practiceSpot: PracticeSpot = 'top_d';
  private wingToggleSign = -1;
  private readonly freePlayStats: FreePlayStats = {
    goalsScored: 0,
    keeperSaves: 0,
    currentStreak: 0,
  };
  private freePlayAutoResetTimer: number | null = null;
  private freePlayReboundIdleTimer = 0;
  private lastSaveNotifyTime = -10;
  private ballHaloEnabled = false;
  private reducedMotion = false;

  private attemptId = 0;
  private simAccumulator = 0;
  private totalTime = 0;
  private isOnTitleScreen = true;
  private titleScreenCameraSnap = true;
  private readonly prefersReducedMotion =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  private isReplaying = false;
  private replayTime = 0;

  // Input tracking
  private readonly keysDown = new Set<string>();
  private aimNormX = 0;
  private aimNormY = 0.28;
  private mouseLeftDown = false;
  private mouseRightDown = false;
  private uiDriveDown = false;
  private uiFlickDown = false;
  private lastReleaseWasLifted = false;
  private releaseShotQueued = false;
  private feintQueued = false;
  private knockAheadQueued = false;
  private liftedModeToggle = false;
  private resolutionScale = 1.0;
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private canvasTouchAimPointerId: number | null = null;
  private lastCanvasTouchX = 0;
  private lastCanvasTouchY = 0;
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
      onPlayFromTitle: () => this.enterGameplayFromTitle(),
      onReturnToTitle: () => this.returnToTitleScreen(),
      onStartAttempt: () => this.startAttempt(),
      onRetryAttempt: () => this.resetToReadyAndStart(true),
      onUnlockSetupByRestart: () => this.prepareReadyState(true),
      onToggleReplay: () => this.toggleReplay(),
      onGameModeChange: (mode) => this.setGameMode(mode),
      onPracticeSpotSelect: (spot) => this.selectPracticeSpot(spot),
      onCallBallToStick: () => this.callBallOrTeeSpot(),
      onShootHoldStart: (lifted) => {
        this.sound.unlock();
        if (this.adjudicator.getPhase() === 'Ready') {
          this.startAttempt();
        }
        if (this.freePlayAutoResetTimer !== null) {
          this.freePlayAutoResetTimer = null;
          this.resetToReadyAndStart(true);
        }
        if (lifted) {
          this.uiFlickDown = true;
          this.lastReleaseWasLifted = true;
        } else {
          this.uiDriveDown = true;
          this.lastReleaseWasLifted = false;
        }
      },
      onShootHoldEnd: (lifted) => {
        if (lifted) this.uiFlickDown = false;
        else this.uiDriveDown = false;
        this.lastReleaseWasLifted = lifted;
        this.releaseShotQueued = true;
      },
      onTouchMoveUpdate: (mx, mz) => {
        this.touchMoveX = mx;
        this.touchMoveZ = mz;
      },
      onTouchAimDelta: (dxNorm, dyNorm) => {
        this.aimNormX = Math.max(-1, Math.min(1, this.aimNormX + dxNorm));
        this.aimNormY = Math.max(0.05, Math.min(1, this.aimNormY + dyNorm));
      },
      onTouchFeint: () => {
        this.sound.unlock();
        if (this.adjudicator.getPhase() === 'Active') {
          this.feintQueued = true;
        }
      },
      onResolutionScaleChange: (scale) => {
        this.setResolutionScale(scale);
      },
      onDifficultyChange: (d) => {
        this.difficulty = d;
      },
      onControlSchemeChange: (c) => {
        this.controlScheme = c;
        this.hud.syncControlScheme(c);
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

  public reportInitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.hud.setLoadingError(`Unable to initialize 3D pitch (${msg}). Please check browser WebGL/WebGPU support and reload.`);
  }

  public async init(): Promise<void> {
    this.hud.setLoadingProgress(0.2, 'Initializing graphics engine...');
    const initRes = await EngineManager.createEngine(this.canvas);
    this.engine = initRes.engine;
    this.backend = initRes.backend;
    this.gpuAdapterInfo = initRes.gpuAdapterInfo;
    this.hud.syncBackendSelection(this.backend);

    this.hud.setLoadingProgress(0.45, 'Building Uddingston pitch & boards...');
    this.scene = new Scene(this.engine);
    this.sceneInstrumentation = new SceneInstrumentation(this.scene);
    this.sceneInstrumentation.captureFrameTime = true;

    this.palette = createMaterialPalette(this.scene);
    this.venue = new VenueScene(this.scene, this.palette);
    this.cameraCtrl = new GameplayCamera(this.scene);

    this.hud.setLoadingProgress(0.68, 'Loading athletes & equipment...');
    this.attackerRig = new AttackerVisualRig(this.palette, this.scene);
    this.keeperRig = new KeeperVisualRig(this.palette, this.scene);
    await Promise.all([
      this.attackerRig.loadAsync(this.scene, this.venue.shadowGenerator ?? undefined),
      this.keeperRig.loadAsync(this.scene, this.venue.shadowGenerator ?? undefined),
    ]);

    this.hud.setLoadingProgress(0.92, 'Setting match pitch...');

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
      { diameter: 0.46, thickness: 0.04, tessellation: 24 },
      this.scene,
    );
    this.aimReticleMesh.rotation.x = Math.PI * 0.5;
    this.aimReticleMesh.material = this.palette.ballHighlightHalo;
    this.aimReticleMesh.isVisible = false;

    this.bindInputs();
    this.hud.syncModeSelection(this.gameMode);
    this.hud.syncVariantSelection('variant_b');
    this.hud.syncPracticeSpotSelection(this.practiceSpot);

    const isCoarseOrTouch = window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0;
    if (isCoarseOrTouch) {
      this.hud.setInputDevice('touch');
    }
    if ((window.innerWidth <= 960 || isCoarseOrTouch) && (window.devicePixelRatio || 1) > 1.5) {
      this.setResolutionScale(0.85);
    } else {
      this.applyResolutionScale();
    }

    this.prepareReadyState(true);
    this.cameraCtrl.updateTitleCamera(1, 0, false, true);
    this.hud.setLoadingComplete();

    window.addEventListener('resize', () => {
      this.applyResolutionScale();
      this.engine.resize();
    });
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

  public enterGameplayFromTitle(): void {
    this.sound.unlock();
    this.isOnTitleScreen = false;
    this.prepareReadyState(true);
    this.startAttempt();
  }

  public returnToTitleScreen(): void {
    this.isOnTitleScreen = true;
    this.titleScreenCameraSnap = true;
    this.prepareReadyState(true);
    const allowIdle = !this.reducedMotion && !this.prefersReducedMotion && this.qualityTier !== 'compatible';
    this.cameraCtrl?.updateTitleCamera(1, this.totalTime, allowIdle, true);
    this.updateHUD();
  }

  private getSpotCoordinates(spot: PracticeSpot): {
    ballX: number;
    ballZ: number;
    attackerX: number;
    attackerZ: number;
    yaw: number;
  } {
    let ballX = 0;
    let ballZ: number = FIH.LINE_23M_DISTANCE;
    if (this.gameMode === 'free_play') {
      if (spot === 'top_d') {
        ballX = 0;
        ballZ = 13.8;
      } else if (spot === 'penalty_spot') {
        ballX = 0;
        ballZ = 6.48;
      } else if (spot === 'wing_angle') {
        ballX = 5.5 * this.wingToggleSign;
        ballZ = 9.8;
      } else {
        ballX = 0;
        ballZ = 22.0;
      }
    }
    const len = Math.max(0.5, Math.hypot(ballX, ballZ));
    const dirX = ballX / len;
    const dirZ = ballZ / len;
    const attackerX = this.gameMode === 'free_play' ? ballX + dirX * 0.68 : 0;
    const attackerZ = this.gameMode === 'free_play' ? ballZ + dirZ * 0.68 : 23.85;
    const yaw = Math.atan2(-ballX, -ballZ);
    return { ballX, ballZ, attackerX, attackerZ, yaw };
  }

  public setGameMode(mode: GameMode): void {
    this.freePlayAutoResetTimer = null;
    this.freePlayReboundIdleTimer = 0;
    this.gameMode = mode;
    this.hud.syncModeSelection(mode);
    const wasReady = this.adjudicator.getPhase() === 'Ready';
    this.prepareReadyState(true);
    if (!wasReady) {
      this.startAttempt();
    }
    this.hud.showToast(
      mode === 'free_play' ? 'Free practice' : 'Shoot-out',
      'info',
    );
  }

  public selectPracticeSpot(spot: PracticeSpot): void {
    this.freePlayAutoResetTimer = null;
    this.freePlayReboundIdleTimer = 0;
    if (spot === 'wing_angle') {
      this.wingToggleSign = this.wingToggleSign === -1 ? 1 : -1;
    }
    this.practiceSpot = spot;
    if (this.gameMode !== 'free_play') {
      this.gameMode = 'free_play';
      this.hud.syncModeSelection('free_play');
    }
    this.hud.syncPracticeSpotSelection(spot);
    this.resetToReadyAndStart(true);
    const labels: Record<PracticeSpot, string> = {
      top_d: 'Top of circle (14 m)',
      penalty_spot: 'Penalty spot (6.5 m)',
      wing_angle: 'Wing angle (11 m)',
      line_23m: '23 m line',
    };
    this.hud.showCaption(`Spot: ${labels[spot]}`);
  }

  public callBallOrTeeSpot(): void {
    this.freePlayAutoResetTimer = null;
    this.freePlayReboundIdleTimer = 0;
    if (this.gameMode === 'free_play') {
      if (this.practiceSpot === 'wing_angle') {
        this.wingToggleSign = this.wingToggleSign === -1 ? 1 : -1;
      }
      this.resetToReadyAndStart(true);
      this.hud.showCaption('Ball re-teed');
    } else {
      this.resetToReadyAndStart(true);
    }
  }

  private prepareReadyState(snapCamera: boolean = true): void {
    this.isReplaying = false;
    this.freePlayAutoResetTimer = null;
    this.freePlayReboundIdleTimer = 0;
    this.replay.clear();
    this.attemptId = this.adjudicator.prepareNewAttempt();
    const spawn = this.getSpotCoordinates(this.practiceSpot);
    this.physics.resetBall({ x: spawn.ballX, y: FIH.BALL_RADIUS, z: spawn.ballZ });
    this.attackerCtrl.reset();
    this.attackerCtrl.pos = { x: spawn.attackerX, y: 0, z: spawn.attackerZ };
    this.attackerCtrl.yaw = spawn.yaw;
    this.keeperAI.reset();
    if (this.gameMode === 'free_play') {
      this.keeperAI.alignToBall(this.physics.ball.pos);
    }
    this.aimNormX = 0;
    this.aimNormY = 0.28;
    this.syncVisualRigTransforms();
    this.cameraCtrl?.update(1, this.attackerCtrl.pos, this.keeperAI.pos, this.physics.ball.pos, snapCamera);
    this.updateHUD();
  }

  public startAttempt(): void {
    this.sound.unlock();
    if (this.adjudicator.getPhase() !== 'Ready') {
      this.prepareReadyState(true);
    }
    this.adjudicator.startWhistle(this.attemptId);
    this.sound.playWhistle(false);
    this.updateHUD();
  }

  public resetToReadyAndStart(autoStart: boolean): void {
    this.sound.unlock();
    this.prepareReadyState(true);
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

    let moveX = this.touchMoveX;
    let moveZ = this.touchMoveZ;
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
      const gpMovedAxis =
        Math.abs(gp.axes[0] ?? 0) > 0.16 ||
        Math.abs(gp.axes[1] ?? 0) > 0.16 ||
        Math.abs(gp.axes[2] ?? 0) > 0.16 ||
        Math.abs(gp.axes[3] ?? 0) > 0.16;
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
      if (gpMovedAxis || gpCharge || gpClose || gpFeint || gpLift || gpSprint) {
        this.hud.setInputDevice('gamepad');
      }
    }

    const feintTriggered = this.feintQueued || gpFeint;
    this.feintQueued = false;

    const releaseShotTriggered = this.releaseShotQueued;
    this.releaseShotQueued = false;

    const chargingShot =
      this.mouseLeftDown ||
      this.mouseRightDown ||
      this.keysDown.has('Space') ||
      this.keysDown.has('KeyF') ||
      this.uiDriveDown ||
      this.uiFlickDown ||
      gpCharge;
    const liftedShotMode =
      this.mouseRightDown ||
      this.keysDown.has('KeyF') ||
      this.uiFlickDown ||
      this.liftedModeToggle ||
      gpLift ||
      (releaseShotTriggered && this.lastReleaseWasLifted);
    if (releaseShotTriggered) {
      this.lastReleaseWasLifted = false;
    }

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

  private getEffectiveInput(input: AttackerInputState): AttackerInputState {
    if (!this.syntheticScriptInput && Math.abs(input.aimNormX) < 0.14) {
      return {
        ...input,
        aimNormX: this.keeperAI.pos.x >= 0 ? 0.26 : -0.26,
      };
    }
    return input;
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

    if (this.isOnTitleScreen) {
      const allowIdle = !this.reducedMotion && !this.prefersReducedMotion && this.qualityTier !== 'compatible';
      this.attackerRig.updateAnimation(0, 0, 0, 0, 0);
      this.keeperRig.updatePose('ready', 0, allowIdle ? this.totalTime * 0.5 : 0);
      this.syncVisualRigTransforms();
      this.aimReticleMesh.isVisible = false;
      this.venue.updateVisualEffects(allowIdle ? dt : 0, this.totalTime);
      this.cameraCtrl.updateTitleCamera(dt, this.totalTime, allowIdle, this.titleScreenCameraSnap);
      this.titleScreenCameraSnap = false;
      this.updateHUD();
      return;
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

    if (this.gameMode === 'free_play' && this.freePlayAutoResetTimer !== null) {
      this.freePlayAutoResetTimer -= dt;
      if (this.freePlayAutoResetTimer <= 0) {
        this.freePlayAutoResetTimer = null;
        this.resetToReadyAndStart(true);
        return;
      }
    }

    const phase = this.adjudicator.getPhase();
    const isActive = phase === 'Active';

    this.simAccumulator += dt;
    while (this.simAccumulator >= FIH.SIM_FIXED_DT - 1e-9) {
      this.simAccumulator -= FIH.SIM_FIXED_DT;

      if (isActive && this.adjudicator.getPhase() === 'Active') {
        if (!this.syntheticScriptInput) {
          if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) {
            this.aimNormX = Math.max(-1, this.aimNormX - FIH.SIM_FIXED_DT * 1.35);
          }
          if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) {
            this.aimNormX = Math.min(1, this.aimNormX + FIH.SIM_FIXED_DT * 1.35);
          }
          if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) {
            this.aimNormY = Math.min(1, this.aimNormY + FIH.SIM_FIXED_DT * 0.9);
          }
          if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) {
            this.aimNormY = Math.max(0.08, this.aimNormY - FIH.SIM_FIXED_DT * 0.9);
          }
        }
        const simInput = this.getEffectiveInput({
          ...input,
          aimNormX: this.syntheticScriptInput ? input.aimNormX : this.aimNormX,
          aimNormY: this.syntheticScriptInput ? input.aimNormY : this.aimNormY,
        });

        if (this.knockAheadQueued) {
          this.knockAheadQueued = false;
          if (this.attackerCtrl.knockAhead(this.physics.ball.pos, this.physics.ball.vel, simInput.aimNormX)) {
            this.sound.playStickStrike(0.35, false);
            this.hud.showCaption('Knock ahead — sprint onto the ball!');
          }
        }

        this.attackerCtrl.step(
          FIH.SIM_FIXED_DT,
          true,
          this.controlScheme,
          simInput,
          this.physics.ball.pos,
          this.physics.ball.vel,
          this.keeperAI.pos,
          (bPos) => {
            const reportedPos =
              this.gameMode === 'free_play'
                ? { x: 0, y: FIH.BALL_RADIUS, z: 10.0 }
                : bPos;
            this.adjudicator.notifyAttackerTouch(this.attemptId, reportedPos, false);
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
            if (this.gameMode === 'free_play') {
              this.hud.showToast('OFF THE POST! REBOUND LIVE', 'info');
            }
          } else if (hit.tag === 'backboard') {
            this.adjudicator.notifyBackboardHit(this.attemptId);
            this.sound.playBackboardBoom();
          } else if (hit.tag.startsWith('keeper_')) {
            if (this.totalTime - this.lastSaveNotifyTime > 0.35) {
              this.lastSaveNotifyTime = this.totalTime;
              this.adjudicator.notifyKeeperSave(this.attemptId);
              this.freePlayStats.keeperSaves += 1;
              if (this.gameMode === 'free_play') {
                this.freePlayStats.currentStreak = 0;
                this.hud.showToast('Keeper save · Rebound live', 'save');
              }
            }
            this.sound.playKeeperPadSave();
            this.venue.burstTurfSpray(hit.point, 12);
          }
        }
        if (stepOut.hitNet && stepOut.netImpactPoint) {
          this.venue.triggerNetRipple(stepOut.netImpactPoint);
        }

        if (this.gameMode === 'free_play' && !this.adjudicator.hasValidCircleTouch() && stepOut.currPos.z < 3.0) {
          this.adjudicator.notifyAttackerTouch(this.attemptId, { x: 0, y: FIH.BALL_RADIUS, z: 10.0 }, false);
        }

        const result = this.adjudicator.step(
          this.attemptId,
          this.gameMode === 'free_play' ? 0 : FIH.SIM_FIXED_DT,
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
          if (this.gameMode === 'free_play') {
            if (result.outcome === 'Goal') {
              this.freePlayStats.goalsScored += 1;
              this.freePlayStats.currentStreak += 1;
              this.hud.showToast(`Goal · ${(result.shotSpeedMps * 3.6).toFixed(0)} km/h`, 'goal');
              this.sound.playWhistle(true);
              this.sound.playCrowdReaction(true);
            } else {
              this.freePlayStats.currentStreak = 0;
              const isSaved = result.outcome === 'Saved' || this.adjudicator.getSavesCount() > 0;
              this.hud.showToast(isSaved ? 'Keeper save' : 'Wide', isSaved ? 'save' : 'wide');
              this.sound.playWhistle(false);
            }
            this.freePlayAutoResetTimer = 1.25;
          } else {
            if (result.outcome === 'Goal') {
              this.freePlayStats.goalsScored += 1;
              this.freePlayStats.currentStreak += 1;
            } else {
              this.freePlayStats.currentStreak = 0;
            }
            this.sound.playWhistle(true);
            this.sound.playCrowdReaction(result.isGoal);
          }
          break;
        }
      }
    }

    if (
      this.gameMode === 'free_play' &&
      this.adjudicator.getPhase() === 'Active' &&
      this.freePlayAutoResetTimer === null
    ) {
      const distBallAttacker = Math.hypot(
        this.physics.ball.pos.x - this.attackerCtrl.pos.x,
        this.physics.ball.pos.z - this.attackerCtrl.pos.z,
      );
      const ballSpd = Math.hypot(this.physics.ball.vel.x, this.physics.ball.vel.z);
      if (
        !this.attackerCtrl.hasPossession &&
        this.adjudicator.getSavesCount() > 0 &&
        ballSpd < 0.45 &&
        distBallAttacker > 3.0 &&
        this.attackerCtrl.getSpeedMps() < 0.6
      ) {
        this.freePlayReboundIdleTimer += dt;
        if (this.freePlayReboundIdleTimer >= 1.1) {
          this.freePlayReboundIdleTimer = 0;
          this.hud.showToast('SAVED BY KEEPER! NEXT BALL READY', 'save');
          this.freePlayAutoResetTimer = 0.85;
        }
      } else {
        this.freePlayReboundIdleTimer = 0;
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
    this.updateAimReticle(this.getEffectiveInput(input));
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
      this.aimReticleMesh.position.set(aimPt.x, aimPt.y, 0.05);
    }
  }

  private updateHUD(): void {
    this.hud.updateState({
      isOnTitleScreen: this.isOnTitleScreen,
      gameMode: this.gameMode,
      freePlayStats: this.freePlayStats,
      phase: this.adjudicator.getPhase(),
      remainingSeconds: this.adjudicator.getRemainingSeconds(),
      hasValidCircleTouch: this.adjudicator.hasValidCircleTouch(),
      charge01: this.attackerCtrl.charge01,
      isLiftedMode: this.mouseRightDown || this.uiFlickDown || this.liftedModeToggle || this.keysDown.has('KeyF'),
      isReplaying: this.isReplaying,
      lastResult: this.adjudicator.getLastResult(),
    });
  }

  private bindInputs(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.hud.toggleDevOverlay();
        return;
      }
      if (e.code === 'Escape') {
        this.hud.closeTransientModals();
        return;
      }

      this.hud.setInputDevice('keyboard');

      const uiHasFocus = Boolean((document.activeElement as HTMLElement | null)?.closest('#ui-root'));
      if (uiHasFocus && (e.code === 'Space' || e.code === 'Enter')) {
        return;
      }

      if (this.isOnTitleScreen) {
        if (e.code === 'Enter' && !this.hud.isSetupOpen() && !this.hud.isHowToOpen() && !this.hud.isSettingsOpen()) {
          this.enterGameplayFromTitle();
        }
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
      }
      if (e.code === 'Enter' && this.adjudicator.getPhase() === 'Ready') {
        this.startAttempt();
        return;
      }
      if (this.hud.isSetupOpen() || this.hud.isHowToOpen()) {
        return;
      }
      if (e.code === 'Digit1') {
        this.selectPracticeSpot('top_d');
        return;
      }
      if (e.code === 'Digit2') {
        this.selectPracticeSpot('penalty_spot');
        return;
      }
      if (e.code === 'Digit3') {
        this.selectPracticeSpot('wing_angle');
        return;
      }
      if (e.code === 'Digit4') {
        this.selectPracticeSpot('line_23m');
        return;
      }
      if (e.code === 'KeyB') {
        this.callBallOrTeeSpot();
        return;
      }
      if (e.code === 'KeyR') {
        if (this.isReplaying) {
          this.isReplaying = false;
        }
        this.resetToReadyAndStart(true);
        return;
      }
      if (this.freePlayAutoResetTimer !== null && (e.code === 'Space' || e.code === 'KeyF')) {
        this.freePlayAutoResetTimer = null;
        this.resetToReadyAndStart(true);
        return;
      }

      if (this.adjudicator.getPhase() === 'Ready') {
        return;
      }

      this.keysDown.add(e.code);
      if (e.code === 'Space' && !e.repeat) {
        this.lastReleaseWasLifted = this.liftedModeToggle || this.keysDown.has('KeyF');
      } else if (e.code === 'KeyF' && !e.repeat) {
        this.lastReleaseWasLifted = true;
      } else if ((e.code === 'KeyE' || e.code === 'ShiftRight') && !e.repeat) {
        this.feintQueued = true;
      } else if (e.code === 'KeyG' && !e.repeat) {
        this.knockAheadQueued = true;
      } else if (e.code === 'KeyL' && !e.repeat) {
        this.liftedModeToggle = !this.liftedModeToggle;
      }
    });

    window.addEventListener('keyup', (e) => {
      const wasDown = this.keysDown.has(e.code);
      this.keysDown.delete(e.code);
      if (!wasDown) return;
      if (e.code === 'Space') {
        this.lastReleaseWasLifted = this.liftedModeToggle || this.keysDown.has('KeyF');
        this.releaseShotQueued = true;
      } else if (e.code === 'KeyF') {
        this.lastReleaseWasLifted = true;
        this.releaseShotQueued = true;
      }
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.hud.setInputDevice('touch');
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.hud.setInputDevice('keyboard');
        const rect = this.canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ny = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
        this.aimNormX = Math.max(-1, Math.min(1, nx * 1.35));
        this.aimNormY = Math.max(0, Math.min(1, ny * 1.15));
      } else if (e.pointerType === 'touch' && e.pointerId === this.canvasTouchAimPointerId) {
        const dx = e.clientX - this.lastCanvasTouchX;
        const dy = e.clientY - this.lastCanvasTouchY;
        this.lastCanvasTouchX = e.clientX;
        this.lastCanvasTouchY = e.clientY;
        this.aimNormX = Math.max(-1, Math.min(1, this.aimNormX + dx / Math.max(140, window.innerWidth * 0.25)));
        this.aimNormY = Math.max(0.05, Math.min(1, this.aimNormY - dy / Math.max(110, window.innerHeight * 0.25)));
      }
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.isOnTitleScreen || this.hud.isSetupOpen() || this.hud.isHowToOpen()) {
        return;
      }
      this.sound.unlock();
      if (e.pointerType === 'touch') {
        this.hud.setInputDevice('touch');
        if (this.canvasTouchAimPointerId === null) {
          this.canvasTouchAimPointerId = e.pointerId;
          this.lastCanvasTouchX = e.clientX;
          this.lastCanvasTouchY = e.clientY;
          try {
            this.canvas.setPointerCapture(e.pointerId);
          } catch {
            // Ignore
          }
        }
        return;
      }

      if (e.pointerType !== 'mouse') return;
      if (this.adjudicator.getPhase() === 'Ready') {
        this.startAttempt();
        return;
      }
      if (this.freePlayAutoResetTimer !== null) {
        this.freePlayAutoResetTimer = null;
        this.resetToReadyAndStart(true);
        return;
      }
      if (e.button === 0) {
        this.mouseLeftDown = true;
        this.lastReleaseWasLifted = false;
      }
      if (e.button === 2) {
        this.mouseRightDown = true;
        this.lastReleaseWasLifted = true;
      }
    });

    const endCanvasPointer = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId === this.canvasTouchAimPointerId) {
        this.canvasTouchAimPointerId = null;
        return;
      }
      if (e.pointerType !== 'mouse') return;
      if (cancelled) {
        this.mouseLeftDown = false;
        this.mouseRightDown = false;
        return;
      }
      if (e.button === 0 && this.mouseLeftDown) {
        this.mouseLeftDown = false;
        this.lastReleaseWasLifted = this.liftedModeToggle || this.keysDown.has('KeyF');
        this.releaseShotQueued = true;
      }
      if (e.button === 2 && this.mouseRightDown) {
        this.mouseRightDown = false;
        this.lastReleaseWasLifted = true;
        this.releaseShotQueued = true;
      }
    };

    window.addEventListener('pointerup', (e) => endCanvasPointer(e, false));
    window.addEventListener('pointercancel', (e) => endCanvasPointer(e, true));

    const clearHeldInputs = () => {
      this.keysDown.clear();
      this.mouseLeftDown = false;
      this.mouseRightDown = false;
      this.uiDriveDown = false;
      this.uiFlickDown = false;
      this.touchMoveX = 0;
      this.touchMoveZ = 0;
      this.canvasTouchAimPointerId = null;
      this.hud.clearActiveTouchPointers();
    };
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearHeldInputs();
      } else {
        this.lastFrameTimestamp = performance.now();
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  public setResolutionScale(scale: number): void {
    this.resolutionScale = Math.max(0.5, Math.min(1.0, scale));
    this.hud.syncResolutionScale(this.resolutionScale);
    this.applyResolutionScale();
  }

  private applyResolutionScale(): void {
    if (!this.engine) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const effective = Math.max(0.5, dpr * this.resolutionScale);
    this.engine.setHardwareScalingLevel(1 / effective);
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
      startAttempt: () => {
        if (this.isOnTitleScreen) {
          this.enterGameplayFromTitle();
        } else {
          this.startAttempt();
        }
      },
      playFromTitle: () => this.enterGameplayFromTitle(),
      returnToTitle: () => this.returnToTitleScreen(),
      setPartnerLogos: (list: PartnerLogoConfig[]) => this.hud.setPartnerLogos(list),
      retryAttempt: () => {
        this.isOnTitleScreen = false;
        this.resetToReadyAndStart(true);
      },
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
      setResolutionScale: (scale: number) => {
        this.setResolutionScale(scale);
      },
      setInputDevice: (device: 'keyboard' | 'gamepad' | 'touch') => {
        this.hud.setInputDevice(device);
      },
      setDifficulty: (d: DifficultyPreset) => {
        this.difficulty = d;
      },
      setGameMode: (mode: GameMode) => {
        this.setGameMode(mode);
      },
      selectPracticeSpot: (spot: PracticeSpot) => {
        this.selectPracticeSpot(spot);
      },
      getFreePlayStats: () => ({ ...this.freePlayStats }),
      setAttackerVariant: (v: AttackerVariant) => {
        this.attackerRig.setVariant(v);
        this.hud.syncVariantSelection(v);
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
