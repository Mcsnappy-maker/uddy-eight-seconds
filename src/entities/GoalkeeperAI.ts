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
    maxSpeedMps: 4.85,
    reactionDelaySec: 0.06,
    commitDurationSec: 0.48,
    recoveryDurationSec: 0.34,
    advanceMaxZ: 3.4,
    feintSusceptibility: 0.42,
  },
  cup_pressure: {
    maxSpeedMps: 5.7,
    reactionDelaySec: 0.03,
    commitDurationSec: 0.46,
    recoveryDurationSec: 0.26,
    advanceMaxZ: 3.8,
    feintSusceptibility: 0.25,
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

  public alignToBall(ballPos: Vec3): void {
    const z = clamp(1.1 + (18.0 - Math.min(18, ballPos.z)) * 0.12, 0.9, 2.4);
    const x = clamp(ballPos.x * (z / Math.max(1.5, ballPos.z)), -1.45, 1.45);
    this.pos = { x, y: 0, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = clamp(Math.atan2(ballPos.x - x, Math.max(0.5, ballPos.z - z)), -0.75, 0.75);
    this.poseMode = 'ready';
    this.saveProgress01 = 0;
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
    const shotFlyingTowardGoal =
      difficulty === 'first_go'
        ? ballVel.z < -4.5 && ballPos.z < 17.5
        : ballVel.z < -3.5 && ballPos.z < 24.5;

    // Perception reacts only to visible ball motion, attacker wind-up, and feints — never hidden aim
    if (Math.abs(attackerFeintLateral) > 0.25 && this.state !== 'commit' && this.state !== 'recover') {
      this.perceivedFeintBias = attackerFeintLateral * tune.feintSusceptibility * 0.72;
    } else {
      this.perceivedFeintBias *= Math.exp(-3.2 * dt);
    }

    if (this.state === 'commit') {
      this.stateTimer += dt;
      this.saveProgress01 = clamp(this.stateTimer / tune.commitDurationSec, 0, 1);
      if (difficulty !== 'first_go' && ballVel.z < -2.0 && ballPos.z > this.pos.z - 0.1) {
        const dz = this.pos.z - ballPos.z;
        const timeToKeeper = dz / Math.min(-0.5, ballVel.z);
        if (timeToKeeper > 0 && timeToKeeper < 0.8) {
          this.committedTargetX = clamp(ballPos.x + ballVel.x * timeToKeeper, -1.85, 1.85);
        }
      }
      const lungeDx = clamp(this.committedTargetX - this.pos.x, -1.8, 1.8);
      if (difficulty === 'first_go') {
        this.vel.x = lungeDx * 4.8 * (1 - this.saveProgress01 * 0.5);
      } else {
        this.vel.x = clamp(lungeDx * 8.5, -8.8, 8.8);
      }
      this.vel.z = 0;
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -2.6, 2.6);

      const readyToRecover =
        difficulty === 'first_go'
          ? this.stateTimer >= tune.commitDurationSec
          : this.stateTimer >= tune.commitDurationSec && (ballPos.z <= this.pos.z + 0.1 || ballVel.z >= -1.0);
      if (readyToRecover) {
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
        const maxCommitWindow = difficulty === 'first_go' ? 0.75 : 0.30;

        if (difficulty !== 'first_go' && timeToKeeper > maxCommitWindow) {
          // Track laterally across goal on long/medium-range shots instead of diving prematurely
          const predX = clamp(ballPos.x + ballVel.x * timeToKeeper, -1.78, 1.78);
          const dxTrack = predX - this.pos.x;
          const trackSpeed = tune.maxSpeedMps * 1.45;
          this.vel.x = clamp(dxTrack * 7.5, -trackSpeed, trackSpeed);
          const desiredDepth = clamp(this.pos.z, 0.8, 2.4);
          this.vel.z = clamp((desiredDepth - this.pos.z) * 4.0, -2.5, 2.5);
          this.pos.x = clamp(this.pos.x + this.vel.x * dt, -1.85, 1.85);
          this.pos.z = clamp(this.pos.z + this.vel.z * dt, 0.45, 2.6);
          this.lateralPhase += Math.abs(this.vel.x) * dt * 3.0;
          this.poseMode = Math.abs(this.vel.x) > 0.25 ? (this.vel.x < 0 ? 'shuffle_left' : 'shuffle_right') : 'ready';
          this.yaw = clamp(Math.atan2(ballPos.x - this.pos.x, Math.max(0.5, ballPos.z - this.pos.z)), -0.75, 0.75);
          return;
        }

        if (timeToKeeper > 0 && timeToKeeper <= maxCommitWindow) {
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
