import { DifficultyPreset, FIH, Vec3 } from '../rules/RulesConfig';
import { KeeperPoseMode } from '../rendering/AthleteModels';

export type KeeperAIState =
  | 'ready'
  | 'assess'
  | 'position'
  | 'advance_hold'
  | 'commit'
  | 'recover'
  | 'reassess';

interface KeeperTuning {
  maxSpeedMps: number;
  reactionDelaySec: number;
  commitDurationSec: number;
  recoveryDurationSec: number;
  advanceMaxZ: number;
  feintSusceptibility: number;
}

const DIFFICULTY_TUNING: Record<DifficultyPreset, KeeperTuning> = {
  first_go: {
    maxSpeedMps: 2.7,
    reactionDelaySec: 0.25,
    commitDurationSec: 0.42,
    recoveryDurationSec: 0.72,
    advanceMaxZ: 3.4,
    feintSusceptibility: 0.85,
  },
  club_challenge: {
    maxSpeedMps: 3.7,
    reactionDelaySec: 0.145,
    commitDurationSec: 0.36,
    recoveryDurationSec: 0.52,
    advanceMaxZ: 5.2,
    feintSusceptibility: 0.52,
  },
  cup_pressure: {
    maxSpeedMps: 4.4,
    reactionDelaySec: 0.095,
    commitDurationSec: 0.32,
    recoveryDurationSec: 0.4,
    advanceMaxZ: 6.4,
    feintSusceptibility: 0.3,
  },
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class GoalkeeperAI {
  public pos: Vec3 = { x: 0, y: 0, z: -0.05 };
  public vel: Vec3 = { x: 0, y: 0, z: 0 };
  public yaw = 0; // Facing +Z toward attacker
  public state: KeeperAIState = 'ready';
  public poseMode: KeeperPoseMode = 'ready';
  public lateralPhase = 0;
  public saveProgress01 = 0;

  private stateTimer = 0;
  private reactionBufferTimer = 0;
  private committedTargetX = 0;
  private perceivedFeintBias = 0;
  private lastBallSpeed = 0;

  public reset(): void {
    this.pos = { x: 0, y: 0, z: -0.05 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.state = 'ready';
    this.poseMode = 'ready';
    this.lateralPhase = 0;
    this.saveProgress01 = 0;
    this.stateTimer = 0;
    this.reactionBufferTimer = 0;
    this.committedTargetX = 0;
    this.perceivedFeintBias = 0;
    this.lastBallSpeed = 0;
  }

  public step(
    dt: number,
    active: boolean,
    difficulty: DifficultyPreset,
    ballPos: Vec3,
    ballVel: Vec3,
    attackerCharge01: number,
    attackerFeintLateral: number,
  ): void {
    if (!active) {
      this.vel = { x: 0, y: 0, z: 0 };
      this.state = 'ready';
      this.poseMode = 'ready';
      this.saveProgress01 = 0;
      return;
    }

    const tune = DIFFICULTY_TUNING[difficulty];
    const ballSpeed = Math.hypot(ballVel.x, ballVel.z);
    const shotFlyingTowardGoal = ballVel.z < -4.5 && ballPos.z < 17.5;

    // Perception reacts only to visible ball motion, attacker wind-up, and feints — never hidden aim
    if (Math.abs(attackerFeintLateral) > 0.25 && this.state !== 'commit' && this.state !== 'recover') {
      this.perceivedFeintBias = attackerFeintLateral * tune.feintSusceptibility * 0.72;
    } else {
      this.perceivedFeintBias *= Math.exp(-3.2 * dt);
    }

    if (this.state === 'commit') {
      this.stateTimer += dt;
      this.saveProgress01 = clamp(this.stateTimer / tune.commitDurationSec, 0, 1);
      const lungeDx = clamp(this.committedTargetX - this.pos.x, -1.5, 1.5);
      this.vel.x = lungeDx * 4.8 * (1 - this.saveProgress01 * 0.5);
      this.vel.z = 0;
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -2.6, 2.6);

      if (this.stateTimer >= tune.commitDurationSec) {
        this.state = 'recover';
        this.stateTimer = 0;
        this.poseMode = 'recover';
      }
      return;
    }

    if (this.state === 'recover') {
      this.stateTimer += dt;
      this.saveProgress01 = clamp(1 - this.stateTimer / tune.recoveryDurationSec, 0, 1);
      this.vel.x *= Math.exp(-6.0 * dt);
      this.vel.z *= Math.exp(-6.0 * dt);
      if (this.stateTimer >= tune.recoveryDurationSec) {
        this.state = 'reassess';
        this.stateTimer = 0;
        this.saveProgress01 = 0;
      }
      return;
    }

    // Detect newly released shot toward goal
    if (shotFlyingTowardGoal && this.lastBallSpeed <= 11.5) {
      this.reactionBufferTimer = tune.reactionDelaySec;
    }
    this.lastBallSpeed = ballSpeed;

    if (shotFlyingTowardGoal) {
      if (this.reactionBufferTimer > 0) {
        this.reactionBufferTimer -= dt;
      } else {
        // Project ball arrival at keeper Z depth
        const dz = this.pos.z - ballPos.z;
        const timeToKeeper = dz / Math.min(-0.5, ballVel.z);
        if (timeToKeeper > 0 && timeToKeeper < 0.75) {
          const predX = clamp(ballPos.x + ballVel.x * timeToKeeper, -2.0, 2.0);
          const predY = ballPos.y + ballVel.y * timeToKeeper - 0.5 * FIH.GRAVITY * timeToKeeper * timeToKeeper;
          this.committedTargetX = predX;
          this.state = 'commit';
          this.stateTimer = 0;
          this.saveProgress01 = 0;

          // Keeper faces +Z: -X world is keeper's left (blocker side); +X world is keeper's right (stick side)
          const dx = predX - this.pos.x;
          if (predY > 0.72 && dx < 0.1) {
            this.poseMode = 'save_high_blocker';
          } else if (predY > 0.55 && dx >= 0.1) {
            this.poseMode = 'save_stick_sweep';
          } else if (dx < 0) {
            this.poseMode = 'save_low_left';
          } else {
            this.poseMode = 'save_low_right';
          }
          return;
        }
      }
    }

    // Angle-bisector positioning & controlled advance once ball enters shooting range
    this.state = ballPos.z < 15.5 ? 'advance_hold' : 'position';
    const goalLineZ = 0.0;
    const distFromGoal = Math.hypot(ballPos.x, Math.max(0.5, ballPos.z - goalLineZ));
    // Keeper steps out to cut angle up to tune.advanceMaxZ, keeping goal depth safe
    const desiredZ =
      ballPos.z > 19.5
        ? 0.45
        : clamp(1.0 + (19.5 - distFromGoal) * 0.34, 0.5, tune.advanceMaxZ);

    // Stand on bisector between ball and center of goal (x=0, z=0), nudged by visible feints
    const bisectorRatio = desiredZ / Math.max(1.2, ballPos.z);
    const targetX = clamp(ballPos.x * bisectorRatio + this.perceivedFeintBias, -1.68, 1.68);

    const dx = targetX - this.pos.x;
    const dz = desiredZ - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // Slow slightly if attacker is winding up so keeper sets feet to react
    const speedFactor = attackerCharge01 > 0.35 ? 0.55 : 1.0;
    const moveSpeed = Math.min(tune.maxSpeedMps * speedFactor, dist * 4.5);

    if (dist > 0.04) {
      this.vel.x = (dx / dist) * moveSpeed;
      this.vel.z = (dz / dist) * moveSpeed;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.lateralPhase += moveSpeed * dt * 3.0;
      this.poseMode = Math.abs(this.vel.x) > 0.35
        ? (this.vel.x < 0 ? 'shuffle_left' : 'shuffle_right')
        : 'advance';
    } else {
      this.vel.x = 0;
      this.vel.z = 0;
      this.poseMode = 'ready';
    }

    // Rotate cleanly toward ball
    const desiredYaw = Math.atan2(ballPos.x - this.pos.x, Math.max(0.5, ballPos.z - this.pos.z));
    this.yaw = clamp(desiredYaw, -0.75, 0.75);
  }
}
