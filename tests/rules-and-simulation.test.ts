import { describe, expect, it } from 'vitest';
import {
  FIH,
  checkWholeBallGoalCrossing,
  isInsideShootingCircle,
  validatePenaltyStrokeAction,
} from '../src/rules/RulesConfig';
import { ShootoutAdjudicator } from '../src/rules/ShootoutAdjudicator';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld';

describe('FIH Geometry & Rules Contract', () => {
  it('verifies official shooting circle geometry (3.66m straight + 14.63m quarter arcs)', () => {
    expect(isInsideShootingCircle(0, 14.63)).toBe(true);
    expect(isInsideShootingCircle(1.83, 14.63)).toBe(true);
    expect(isInsideShootingCircle(-1.83, 14.63)).toBe(true);
    // Quarter arc at 45 deg
    const arcX = 1.83 + 14.63 * Math.cos(Math.PI / 4);
    const arcZ = 14.63 * Math.sin(Math.PI / 4);
    expect(isInsideShootingCircle(arcX - 0.02, arcZ - 0.02)).toBe(true);
    expect(isInsideShootingCircle(12, 12)).toBe(false);
    expect(isInsideShootingCircle(0, FIH.LINE_23M_DISTANCE)).toBe(false);
  });

  it('requires whole ball to cross goal plane inside aperture', () => {
    // Partial crossing (ball center at -0.02, radius is 0.0365) -> NOT a goal
    expect(
      checkWholeBallGoalCrossing(
        { x: 0, y: 0.2, z: 0.1 },
        { x: 0, y: 0.2, z: -0.02 },
      ),
    ).toBe(false);

    // Whole ball cleared plane (z = -0.04 <= -0.0365) -> GOAL
    expect(
      checkWholeBallGoalCrossing(
        { x: 0, y: 0.2, z: 0.05 },
        { x: 0, y: 0.2, z: -0.04 },
      ),
    ).toBe(true);

    // Ball overlapping goalpost inner edge (|x| = 1.81 > 1.83 - 0.0365) -> NOT a goal
    expect(
      checkWholeBallGoalCrossing(
        { x: 1.81, y: 0.2, z: 0.05 },
        { x: 1.81, y: 0.2, z: -0.05 },
      ),
    ).toBe(false);

    // Ball overlapping crossbar underside (y = 2.12 > 2.14 - 0.0365) -> NOT a goal
    expect(
      checkWholeBallGoalCrossing(
        { x: 0, y: 2.12, z: 0.05 },
        { x: 0, y: 2.12, z: -0.05 },
      ),
    ).toBe(false);
  });

  it('enforces distinct Penalty-Stroke single-contact & technique rules', () => {
    expect(
      validatePenaltyStrokeAction({
        whistleBlown: true,
        contactCount: 1,
        actionType: 'flick',
        keeperFeetOnLineAtContact: true,
      }).legal,
    ).toBe(true);

    expect(
      validatePenaltyStrokeAction({
        whistleBlown: true,
        contactCount: 2,
        actionType: 'push',
        keeperFeetOnLineAtContact: true,
      }).legal,
    ).toBe(false);

    expect(
      validatePenaltyStrokeAction({
        whistleBlown: true,
        contactCount: 1,
        actionType: 'hit',
        keeperFeetOnLineAtContact: true,
      }).legal,
    ).toBe(false);
  });
});

describe('ShootoutAdjudicator & 120Hz PhysicsWorld', () => {
  it('awards a legal goal when played inside circle and crossing before 8.000s', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    expect(adj.startWhistle(id)).toBe(true);

    adj.notifyAttackerTouch(id, { x: 0, y: FIH.BALL_RADIUS, z: 10.0 });
    const res = adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 0.4, y: 0.2, z: 0.1 },
      { x: 0.4, y: 0.2, z: -0.05 },
      18,
    );
    expect(res?.outcome).toBe('Goal');
    expect(res?.isGoal).toBe(true);
  });

  it('rejects a goal crossed at 8.001s with zero post-buzzer grace period', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    adj.startWhistle(id);
    adj.notifyAttackerTouch(id, { x: 0, y: FIH.BALL_RADIUS, z: 8.0 });

    // Advance 960 ticks (8.000 s exactly) without scoring
    for (let i = 0; i < 960; i += 1) {
      const r = adj.step(id, FIH.SIM_FIXED_DT, { x: 0, y: 0.2, z: 2.0 }, { x: 0, y: 0.2, z: 1.9 }, 15);
      expect(r).toBeNull();
    }

    // 961st tick crosses 8.000s even while ball enters goal
    const timeoutRes = adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.2, z: 0.05 },
      { x: 0, y: 0.2, z: -0.05 },
      25,
    );
    expect(timeoutRes?.outcome).toBe('Time');
    expect(timeoutRes?.isGoal).toBe(false);
  });

  it('rejects a shot struck outside the circle that never gets touched inside', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    adj.startWhistle(id);
    // Struck from z = 18m (outside 14.63m circle)
    adj.notifyAttackerTouch(id, { x: 0, y: FIH.BALL_RADIUS, z: 18.0 });

    const res = adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.2, z: 0.05 },
      { x: 0, y: 0.2, z: -0.05 },
      24,
    );
    expect(res?.outcome).toBe('Foul');
    expect(res?.isGoal).toBe(false);
  });

  it('keeps attempt alive on keeper save and awards goal on live rebound', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    adj.startWhistle(id);
    adj.notifyAttackerTouch(id, { x: -1.0, y: FIH.BALL_RADIUS, z: 7.0 });
    adj.notifyKeeperSave(id);

    const midRes = adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.2, z: 1.0 },
      { x: 0.5, y: 0.2, z: 2.5 },
      12,
    );
    expect(midRes).toBeNull();
    expect(adj.getPhase()).toBe('Active');
    expect(adj.getSavesCount()).toBe(1);

    adj.notifyAttackerTouch(id, { x: 0.6, y: FIH.BALL_RADIUS, z: 3.0 });
    const goalRes = adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 0.9, y: 0.15, z: 0.05 },
      { x: 0.9, y: 0.15, z: -0.06 },
      20,
    );
    expect(goalRes?.outcome).toBe('Goal');
    expect(goalRes?.savesCount).toBe(1);
  });

  it('ends attempt cleanly when ball goes out over back-line outside posts', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    adj.startWhistle(id);
    adj.notifyAttackerTouch(id, { x: 0, y: FIH.BALL_RADIUS, z: 10.0 });

    const outRes = adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 2.3, y: 0.2, z: 0.1 },
      { x: 2.3, y: 0.2, z: -0.08 },
      20,
    );
    expect(outRes?.outcome).toBe('Wide');
    expect(outRes?.isGoal).toBe(false);
  });

  it('discards stale attempt events after retry increments attemptId', () => {
    const adj = new ShootoutAdjudicator();
    const firstId = adj.prepareNewAttempt();
    adj.startWhistle(firstId);

    const secondId = adj.prepareNewAttempt();
    expect(secondId).toBe(firstId + 1);
    adj.startWhistle(secondId);

    // Stale event from firstId must not end or affect secondId
    const staleRes = adj.step(
      firstId,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.1, z: 0.1 },
      { x: 0, y: 0.1, z: -0.08 },
      20,
    );
    expect(staleRes).toBeNull();
    expect(adj.getPhase()).toBe('Active');
  });

  it('prevents 40 m/s stress-test shot from tunnelling through 50mm goalpost via 8x CCD substeps', () => {
    const world = new PhysicsWorld();
    // Place ball 0.35 m directly in front of right goalpost center (x = 1.855)
    world.resetBall({ x: 1.855, y: 0.5, z: 0.35 });
    world.ball.vel = { x: 0, y: 0, z: -40.0 };

    let hitPost = false;
    for (let i = 0; i < 6; i += 1) {
      const out = world.step(FIH.SIM_FIXED_DT);
      if (out.hits.some((h) => h.tag === 'post')) {
        hitPost = true;
      }
    }
    expect(hitPost).toBe(true);
    // Ball must bounce back onto pitch (+z) instead of tunnelling straight into net
    expect(world.ball.vel.z).toBeGreaterThan(0);
    expect(world.ball.pos.z).toBeGreaterThan(0);
  });

  it('collides realistically with keeper kicker OBB and deflects ball', () => {
    const world = new PhysicsWorld();
    world.setDynamicColliders([
      {
        id: 'keeper_left_kicker',
        tag: 'keeper_kicker',
        center: { x: 0.25, y: 0.12, z: 1.2 },
        halfExtents: { x: 0.14, y: 0.12, z: 0.18 },
        yaw: 0,
        restitution: 0.58,
      },
    ]);
    world.resetBall({ x: 0.25, y: 0.12, z: 1.7 });
    world.ball.vel = { x: 0, y: 0, z: -22.0 };

    let hitKicker = false;
    for (let i = 0; i < 10; i += 1) {
      const out = world.step(FIH.SIM_FIXED_DT);
      if (out.hits.some((h) => h.tag === 'keeper_kicker')) {
        hitKicker = true;
      }
    }
    expect(hitKicker).toBe(true);
    expect(world.ball.vel.z).toBeGreaterThan(0);
  });

  it('rejects back-of-stick offence and intentional/unintentional keeper offences cleanly', () => {
    const adj1 = new ShootoutAdjudicator();
    const id1 = adj1.prepareNewAttempt();
    adj1.startWhistle(id1);
    adj1.notifyAttackerTouch(id1, { x: 0, y: FIH.BALL_RADIUS, z: 10 }, true);
    expect(adj1.getLastResult()?.outcome).toBe('Foul');

    const adj2 = new ShootoutAdjudicator();
    const id2 = adj2.prepareNewAttempt();
    adj2.startWhistle(id2);
    adj2.notifyKeeperOffence(id2, false);
    expect(adj2.getLastResult()?.outcome).toBe('Retake');

    const adj3 = new ShootoutAdjudicator();
    const id3 = adj3.prepareNewAttempt();
    adj3.startWhistle(id3);
    adj3.notifyKeeperOffence(id3, true);
    expect(adj3.getLastResult()?.outcome).toBe('Foul');
  });

  it('keeps shoot-out live on post rebound and invalidates if ball leaves circle without re-touch', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    adj.startWhistle(id);
    adj.notifyAttackerTouch(id, { x: 0.5, y: FIH.BALL_RADIUS, z: 9.0 });
    adj.notifyPostHit(id);
    expect(adj.getPhase()).toBe('Active');

    // Ball rebounds outside shooting circle (z = 16.0) without attacker re-touch
    adj.step(
      id,
      FIH.SIM_FIXED_DT,
      { x: 0, y: 0.1, z: 14.0 },
      { x: 0, y: 0.1, z: 16.0 },
      10,
    );
    expect(adj.hasValidCircleTouch()).toBe(false);
  });

  it('keeps fixed 120Hz simulation timing accurate under low 10fps frame delta accumulation', () => {
    const adj = new ShootoutAdjudicator();
    const id = adj.prepareNewAttempt();
    adj.startWhistle(id);
    adj.notifyAttackerTouch(id, { x: 0, y: FIH.BALL_RADIUS, z: 8.0 });

    const renderFrameDt = 0.1; // 10 FPS render rate
    let accumulator = 0;
    let totalTicks = 0;
    for (let f = 0; f < 80; f += 1) {
      accumulator += renderFrameDt;
      while (accumulator >= FIH.SIM_FIXED_DT - 1e-9) {
        accumulator -= FIH.SIM_FIXED_DT;
        totalTicks += 1;
        adj.step(id, FIH.SIM_FIXED_DT, { x: 0, y: 0.1, z: 4 }, { x: 0, y: 0.1, z: 3.9 }, 5);
      }
    }
    expect(totalTicks).toBe(960);
    expect(adj.getPhase()).toBe('Active');

    // One more fixed tick passes 8.000 s
    const res = adj.step(id, FIH.SIM_FIXED_DT, { x: 0, y: 0.1, z: 3.9 }, { x: 0, y: 0.1, z: 3.8 }, 5);
    expect(res?.outcome).toBe('Time');
  });
});
