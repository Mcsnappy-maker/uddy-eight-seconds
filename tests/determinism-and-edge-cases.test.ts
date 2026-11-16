import { describe, expect, it } from 'vitest';
import { AttackerController, AttackerInputState } from '../src/entities/AttackerController';
import { GoalkeeperAI } from '../src/entities/GoalkeeperAI';
import { FIH, Vec3 } from '../src/rules/RulesConfig';
import { AttemptResult, ShootoutAdjudicator } from '../src/rules/ShootoutAdjudicator';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld';

interface RecordedTapeFrame {
  tick: number;
  input: AttackerInputState;
}

function buildDeterministicShootoutTape(): RecordedTapeFrame[] {
  const tape: RecordedTapeFrame[] = [];
  for (let t = 0; t < 480; t += 1) {
    // 0.0–1.9s: sprint forward diagonally toward circle
    // 1.9–2.1s: V-drag feint inside circle
    // 2.1–2.45s: charge low corner drive
    // 2.45s+: release shot
    const charging = t >= 252 && t < 294;
    const release = t === 294;
    const feint = t === 228;
    tape.push({
      tick: t,
      input: {
        moveX: t < 160 ? -0.16 : 0.08,
        moveZ: t < 294 ? 1.0 : 0.0,
        sprint: t < 252,
        closeControl: false,
        feintTriggered: feint,
        aimNormX: 0.78,
        aimNormY: 0.16,
        chargingShot: charging,
        liftedShotMode: false,
        releaseShotTriggered: release,
      },
    });
  }
  return tape;
}

function runTapeAtRenderFPS(frameDeltas: number[]): {
  ticksSimulated: number;
  finalBallPos: Vec3;
  finalAttackerPos: Vec3;
  finalKeeperPos: Vec3;
  result: AttemptResult | null;
} {
  const tape = buildDeterministicShootoutTape();
  const physics = new PhysicsWorld();
  const adj = new ShootoutAdjudicator();
  const attacker = new AttackerController();
  const keeper = new GoalkeeperAI();

  const attemptId = adj.prepareNewAttempt();
  adj.startWhistle(attemptId);

  let accum = 0;
  let simTick = 0;

  for (const frameDt of frameDeltas) {
    accum += frameDt;
    while (accum >= FIH.SIM_FIXED_DT - 1e-9 && adj.getPhase() === 'Active' && simTick < tape.length) {
      accum -= FIH.SIM_FIXED_DT;
      const input = tape[simTick].input;
      simTick += 1;

      attacker.step(
        FIH.SIM_FIXED_DT,
        true,
        'standard',
        input,
        physics.ball.pos,
        physics.ball.vel,
        keeper.pos,
        (bPos) => adj.notifyAttackerTouch(attemptId, bPos, false),
        () => {},
      );

      keeper.step(
        FIH.SIM_FIXED_DT,
        true,
        'first_go',
        physics.ball.pos,
        physics.ball.vel,
        attacker.charge01,
        attacker.getFeintLateral(),
      );

      physics.setDynamicColliders([
        {
          id: 'gk_body',
          tag: 'keeper_pad',
          center: { x: keeper.pos.x, y: 0.6, z: keeper.pos.z },
          halfExtents: { x: 0.25, y: 0.6, z: 0.16 },
          yaw: keeper.yaw,
          restitution: 0.48,
          velocity: keeper.vel,
        },
      ]);

      const stepOut = physics.step(FIH.SIM_FIXED_DT);
      for (const hit of stepOut.hits) {
        if (hit.tag === 'post') adj.notifyPostHit(attemptId);
        else if (hit.tag === 'backboard') adj.notifyBackboardHit(attemptId);
        else if (hit.tag.startsWith('keeper_')) adj.notifyKeeperSave(attemptId);
      }

      adj.step(attemptId, FIH.SIM_FIXED_DT, stepOut.prevPos, stepOut.currPos, stepOut.speedMps);
    }
  }

  return {
    ticksSimulated: simTick,
    finalBallPos: { ...physics.ball.pos },
    finalAttackerPos: { ...attacker.pos },
    finalKeeperPos: { ...keeper.pos },
    result: adj.getLastResult(),
  };
}

describe('Determinism Across Render Frame Rates', () => {
  it('produces identical outcomes, tick counts, and ball/athlete coordinates across 30Hz, 60Hz, 144Hz, and jittered frame times', () => {
    const deltas60 = Array.from({ length: 240 }, () => 1 / 60);
    const deltas30 = Array.from({ length: 120 }, () => 1 / 30);
    const deltas144 = Array.from({ length: 576 }, () => 1 / 144);
    const deltasJittered: number[] = [];
    let sum = 0;
    let seed = 42;
    while (sum < 4.0) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const dt = 0.004 + (seed / 0xffffffff) * 0.045;
      deltasJittered.push(dt);
      sum += dt;
    }

    const r60 = runTapeAtRenderFPS(deltas60);
    const r30 = runTapeAtRenderFPS(deltas30);
    const r144 = runTapeAtRenderFPS(deltas144);
    const rJitter = runTapeAtRenderFPS(deltasJittered);

    expect(r60.result?.outcome).toBe('Goal');
    expect(r30.ticksSimulated).toBe(r60.ticksSimulated);
    expect(r144.ticksSimulated).toBe(r60.ticksSimulated);
    expect(rJitter.ticksSimulated).toBe(r60.ticksSimulated);

    for (const run of [r30, r144, rJitter]) {
      expect(run.result?.outcome).toBe(r60.result?.outcome);
      expect(run.result?.elapsedSeconds).toBeCloseTo(r60.result!.elapsedSeconds, 9);
      expect(run.finalBallPos.x).toBeCloseTo(r60.finalBallPos.x, 9);
      expect(run.finalBallPos.y).toBeCloseTo(r60.finalBallPos.y, 9);
      expect(run.finalBallPos.z).toBeCloseTo(r60.finalBallPos.z, 9);
      expect(run.finalAttackerPos.x).toBeCloseTo(r60.finalAttackerPos.x, 9);
      expect(run.finalAttackerPos.z).toBeCloseTo(r60.finalAttackerPos.z, 9);
      expect(run.finalKeeperPos.x).toBeCloseTo(r60.finalKeeperPos.x, 9);
    }
  });
});

describe('High-Speed Grazing Collision & Boundary Precision', () => {
  it('blocks 40 m/s oblique 12-degree grazing shot on inner 50mm goalpost without tunnelling', () => {
    const world = new PhysicsWorld();
    const angleRad = (12 * Math.PI) / 180;
    const speed = 40.0;
    // Aim so ball grazes the inner edge of the right goalpost (inner face at x = +1.83)
    world.resetBall({ x: 1.72, y: 0.45, z: 0.45 });
    world.ball.vel = {
      x: Math.sin(angleRad) * speed,
      y: 0,
      z: -Math.cos(angleRad) * speed,
    };

    let hitPost = false;
    for (let i = 0; i < 6; i += 1) {
      const out = world.step(FIH.SIM_FIXED_DT);
      if (out.hits.some((h) => h.colliderId === 'goal_post_right')) {
        hitPost = true;
      }
    }
    expect(hitPost).toBe(true);
    // Ball must deflect inward/back rather than tunnelling straight through post width
    expect(world.ball.vel.x).toBeLessThan(0);
  });

  it('blocks 35 m/s shot grazing the crossbar underside (y = 2.14) without tunnelling', () => {
    const world = new PhysicsWorld();
    world.resetBall({ x: 0, y: 2.06, z: 0.25 });
    world.ball.vel = { x: 0, y: 7.5, z: -35.0 };

    let hitBar = false;
    let bouncedDownOrBack = false;
    for (let i = 0; i < 6; i += 1) {
      const out = world.step(FIH.SIM_FIXED_DT);
      if (out.hits.some((h) => h.colliderId === 'goal_crossbar')) {
        hitBar = true;
        if (world.ball.vel.y < 0 || world.ball.vel.z > 0) {
          bouncedDownOrBack = true;
        }
      }
    }
    expect(hitBar).toBe(true);
    expect(bouncedDownOrBack).toBe(true);
  });

  it('contains high-speed ball against backboard & sideboards cleanly inside goal box', () => {
    const world = new PhysicsWorld();
    world.resetBall({ x: 1.65, y: 0.2, z: -0.9 });
    world.ball.vel = { x: 12.0, y: 0, z: -28.0 };

    let hitBoard = false;
    for (let i = 0; i < 8; i += 1) {
      const out = world.step(FIH.SIM_FIXED_DT);
      if (out.hits.some((h) => h.tag === 'backboard')) {
        hitBoard = true;
      }
    }
    expect(hitBoard).toBe(true);
    expect(world.ball.pos.z).toBeGreaterThanOrEqual(-FIH.GOAL_DEPTH_BOTTOM - FIH.BALL_RADIUS);
    expect(world.ball.pos.x).toBeLessThanOrEqual(FIH.GOAL_HALF_WIDTH);
  });

  it('distinguishes 1.5mm short of whole-ball crossing vs valid crossing at the 8.000s deadline', () => {
    const adjShort = new ShootoutAdjudicator();
    const id1 = adjShort.prepareNewAttempt();
    adjShort.startWhistle(id1);
    adjShort.notifyAttackerTouch(id1, { x: 0, y: FIH.BALL_RADIUS, z: 8 });
    for (let i = 0; i < 959; i += 1) {
      adjShort.step(id1, FIH.SIM_FIXED_DT, { x: 0, y: 0.2, z: 0.2 }, { x: 0, y: 0.2, z: 0.1 }, 10);
    }
    // Tick 960 (t = 8.000s): ball at z = -0.035 (1.5mm short of -0.0365 whole-ball line) -> still Active!
    const at8000 = adjShort.step(
      id1,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.2, z: 0.0 },
      { x: 0, y: 0.2, z: -0.035 },
      10,
    );
    expect(at8000).toBeNull();
    // Tick 961 (t = 8.008s): deadline exceeded -> Time!
    const at8008 = adjShort.step(
      id1,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.2, z: -0.035 },
      { x: 0, y: 0.2, z: -0.045 },
      10,
    );
    expect(at8008?.outcome).toBe('Time');

    // Valid whole-ball crossing at tick 960 (t = 8.000s, z = -0.037 <= -0.0365) -> Goal!
    const adjGoal = new ShootoutAdjudicator();
    const id2 = adjGoal.prepareNewAttempt();
    adjGoal.startWhistle(id2);
    adjGoal.notifyAttackerTouch(id2, { x: 0, y: FIH.BALL_RADIUS, z: 8 });
    for (let i = 0; i < 959; i += 1) {
      adjGoal.step(id2, FIH.SIM_FIXED_DT, { x: 0, y: 0.2, z: 0.2 }, { x: 0, y: 0.2, z: 0.1 }, 10);
    }
    const goalAt8000 = adjGoal.step(
      id2,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.2, z: 0.0 },
      { x: 0, y: 0.2, z: -0.037 },
      10,
    );
    expect(goalAt8000?.outcome).toBe('Goal');
  });
});

describe('Fair Goalkeeper AI Perception Contract', () => {
  it('never reads hidden player aim coordinates prior to shot release', () => {
    const runApproachWithAim = (aimX: number, aimY: number) => {
      const keeper = new GoalkeeperAI();
      const attacker = new AttackerController();
      const ballPos: Vec3 = { x: 0, y: FIH.BALL_RADIUS, z: FIH.LINE_23M_DISTANCE };
      const ballVel: Vec3 = { x: 0, y: 0, z: 0 };

      for (let i = 0; i < 240; i += 1) {
        const input: AttackerInputState = {
          moveX: 0.1,
          moveZ: 1.0,
          sprint: true,
          closeControl: false,
          feintTriggered: false,
          aimNormX: aimX,
          aimNormY: aimY,
          chargingShot: i > 200,
          liftedShotMode: aimY > 0.5,
          releaseShotTriggered: false,
        };
        attacker.step(FIH.SIM_FIXED_DT, true, 'standard', input, ballPos, ballVel, keeper.pos, () => {}, () => {});
        ballPos.x += ballVel.x * FIH.SIM_FIXED_DT;
        ballPos.z += ballVel.z * FIH.SIM_FIXED_DT;
        keeper.step(
          FIH.SIM_FIXED_DT,
          true,
          'cup_pressure',
          ballPos,
          ballVel,
          attacker.charge01,
          attacker.getFeintLateral(),
        );
      }
      return { keeperPos: { ...keeper.pos }, pose: keeper.poseMode, state: keeper.state };
    };

    const leftAim = runApproachWithAim(-1.0, 0.0);
    const rightAim = runApproachWithAim(1.0, 1.0);

    expect(leftAim.keeperPos.x).toBe(rightAim.keeperPos.x);
    expect(leftAim.keeperPos.z).toBe(rightAim.keeperPos.z);
    expect(leftAim.pose).toBe(rightAim.pose);
    expect(leftAim.state).toBe(rightAim.state);
  });
});
