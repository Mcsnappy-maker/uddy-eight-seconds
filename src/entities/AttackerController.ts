import {
  ControlScheme,
  FIH,
  Vec3,
} from '../rules/RulesConfig';

export interface AttackerInputState {
  moveX: number; // +1 screen right (-X world), -1 screen left (+X world)
  moveZ: number; // +1 forward toward goal (-Z world), -1 back (+Z world)
  sprint: boolean;
  closeControl: boolean;
  feintTriggered: boolean;
  aimNormX: number; // -1 (screen left / +X goal) to +1 (screen right / -X goal)
  aimNormY: number; // 0 (ground) to 1 (top corners)
  chargingShot: boolean;
  liftedShotMode: boolean;
  releaseShotTriggered: boolean;
}

export interface ShotLaunchCommand {
  targetPoint: Vec3;
  speedMps: number;
  isLifted: boolean;
  power01: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class AttackerController {
  public pos: Vec3 = { x: 0, y: 0, z: 23.85 };
  public vel: Vec3 = { x: 0, y: 0, z: 0 };
  public yaw: number = Math.PI; // Facing -Z toward goal
  public walkPhase = 0;
  public charge01 = 0;
  public swingTimer = 0;
  public feintTimer = 0;
  public feintDir = 1;
  public hasPossession = true;
  private reacquireCooldown = 0;
  private wasCharging = false;

  public reset(): void {
    this.pos = { x: 0, y: 0, z: 23.85 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = Math.PI;
    this.walkPhase = 0;
    this.charge01 = 0;
    this.swingTimer = 0;
    this.feintTimer = 0;
    this.hasPossession = true;
    this.reacquireCooldown = 0;
    this.wasCharging = false;
  }

  public getSpeedMps(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  public getSwing01(): number {
    if (this.swingTimer <= 0) return 0;
    return clamp(1 - this.swingTimer / 0.24, 0, 1);
  }

  public getFeintLateral(): number {
    if (this.feintTimer <= 0) return 0;
    const p = 1 - this.feintTimer / 0.34;
    return Math.sin(p * Math.PI * 2) * this.feintDir;
  }

  public knockAhead(ballPos: Vec3, ballVel: Vec3, aimNormX: number): boolean {
    const dist = Math.hypot(ballPos.x - this.pos.x, ballPos.z - this.pos.z);
    if (!this.hasPossession && dist > 1.85) return false;
    const targetX = clamp(-aimNormX * 1.4, -2.5, 2.5);
    const dirX = targetX - ballPos.x;
    const dirZ = -1.0 - ballPos.z;
    const len = Math.max(0.5, Math.hypot(dirX, dirZ));
    const speed = 9.8;
    ballVel.x = (dirX / len) * speed;
    ballVel.z = (dirZ / len) * speed;
    ballVel.y = 0;
    this.hasPossession = false;
    this.reacquireCooldown = 0.22;
    this.swingTimer = 0.16;
    return true;
  }

  public getAimGoalPoint(aimNormX: number, aimNormY: number, isLifted: boolean): Vec3 {
    // Screen left (-1) maps to +X world goal side; screen right (+1) maps to -X world goal side
    const targetX = clamp(-aimNormX * 1.72, -1.72, 1.72);
    const targetY = isLifted ? clamp(0.45 + aimNormY * 1.48, 0.45, 1.93) : clamp(0.06 + aimNormY * 0.25, 0.06, 0.32);
    return { x: targetX, y: targetY, z: -0.05 };
  }

  public step(
    dt: number,
    active: boolean,
    scheme: ControlScheme,
    input: AttackerInputState,
    ballPos: Vec3,
    ballVel: Vec3,
    keeperPos: Vec3,
    onDribbleTouch: (ballPos: Vec3) => void,
    onShotReleased: (cmd: ShotLaunchCommand) => void,
  ): void {
    if (this.reacquireCooldown > 0) {
      this.reacquireCooldown = Math.max(0, this.reacquireCooldown - dt);
    }
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
    }
    if (this.feintTimer > 0) {
      this.feintTimer = Math.max(0, this.feintTimer - dt);
    }

    if (!active) {
      this.vel.x = 0;
      this.vel.z = 0;
      this.charge01 = 0;
      this.wasCharging = false;
      return;
    }

    // Trigger V-drag feint
    if (input.feintTriggered && this.feintTimer <= 0 && this.hasPossession) {
      this.feintTimer = 0.34;
      this.feintDir = input.moveX >= 0 ? 1 : -1;
    }

    // Desired movement vector in world coords (Camera sits at +Z looking toward -Z)
    // So screen forward (+moveZ) -> -Z world; screen right (+moveX) -> -X world.
    let wishX = -input.moveX;
    let wishZ = -input.moveZ;

    if (scheme === 'simplified') {
      // Assisted approach: moves smoothly toward optimal circle shooting slot while letting player steer lane
      const distToBall = Math.hypot(ballPos.x - this.pos.x, ballPos.z - this.pos.z);
      if (!this.hasPossession && distToBall > 0.7) {
        wishX = ballPos.x - this.pos.x;
        wishZ = ballPos.z - this.pos.z;
      } else if (Math.abs(input.moveZ) < 0.05 && this.pos.z > 6.5) {
        wishZ = -1;
        wishX = -input.moveX * 0.65;
      }
    }

    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1e-4) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    const maxSpeed = input.closeControl ? 4.4 : input.sprint ? 7.6 : 6.4;
    const accel = 22.0;
    const targetVx = wishX * maxSpeed;
    const targetVz = wishZ * maxSpeed;
    this.vel.x += clamp(targetVx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += clamp(targetVz - this.vel.z, -accel * dt, accel * dt);

    // Integrate attacker position and keep within pitch bounds + separate from goalkeeper body
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -FIH.PITCH_HALF_WIDTH + 1.0, FIH.PITCH_HALF_WIDTH - 1.0);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, 0.35, 32.0);

    const kDx = this.pos.x - keeperPos.x;
    const kDz = this.pos.z - keeperPos.z;
    const kDist = Math.hypot(kDx, kDz);
    const minSep = 0.95;
    if (kDist < minSep) {
      const nx = kDist > 1e-4 ? kDx / kDist : 0;
      const nz = kDist > 1e-4 ? kDz / kDist : 1;
      this.pos.x = keeperPos.x + nx * minSep;
      this.pos.z = Math.max(0.35, keeperPos.z + nz * minSep);
      this.vel.x *= 0.25;
      this.vel.z = Math.max(0, this.vel.z);
    }

    const speed = this.getSpeedMps();
    if (speed > 0.25) {
      this.walkPhase += speed * dt * 2.1;
      const desiredYaw = Math.atan2(this.vel.x, this.vel.z);
      let diff = desiredYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += clamp(diff, -8.5 * dt, 8.5 * dt);
    }

    // Dribble possession check (world-object ball constrained smoothly near stick blade)
    const dxB = ballPos.x - this.pos.x;
    const dzB = ballPos.z - this.pos.z;
    const distBall = Math.hypot(dxB, dzB);
    const ballSpeed = Math.hypot(ballVel.x, ballVel.z);

    if (this.reacquireCooldown <= 0 && distBall <= 1.30 && ballPos.y <= 0.45) {
      if (!this.hasPossession && ballSpeed < 16.0) {
        this.hasPossession = true;
      }
    } else if (distBall > 1.65) {
      this.hasPossession = false;
    }

    // Keep ball softly guided ahead of the stick head while dribbling
    if (this.hasPossession) {
      const fwdX = Math.sin(this.yaw);
      const fwdZ = Math.cos(this.yaw);
      const rightX = fwdZ;
      const rightZ = -fwdX;
      const feintOffset = this.getFeintLateral() * 0.42;
      const stickCarryDist = 0.62;
      const sideOffset = 0.18 + feintOffset;

      const idealX = this.pos.x + fwdX * stickCarryDist + rightX * sideOffset;
      const idealZ = this.pos.z + fwdZ * stickCarryDist + rightZ * sideOffset;

      const pull = 18.0;
      ballVel.x = (idealX - ballPos.x) * pull + this.vel.x * 0.92;
      ballVel.z = (idealZ - ballPos.z) * pull + this.vel.z * 0.92;
      ballVel.y = Math.min(ballVel.y, 0);
      onDribbleTouch(ballPos);
    }

    // Shot Charging & Release (generous reach so rolling and rebounding shots connect cleanly)
    const canShoot = this.hasPossession || (distBall <= 1.85 && ballPos.y <= 0.65 && this.reacquireCooldown <= 0);
    if (input.chargingShot && canShoot) {
      this.wasCharging = true;
      this.charge01 = clamp(this.charge01 + dt * 1.45, 0.25, 1.0);
      // Face goal smoothly while winding up
      const goalYaw = Math.atan2(-this.pos.x, -this.pos.z);
      let diff = goalYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += clamp(diff, -10 * dt, 10 * dt);
    } else if ((this.wasCharging || input.releaseShotTriggered) && canShoot) {
      const power = clamp(Math.max(0.55, this.charge01), 0.55, 1.0);
      this.wasCharging = false;
      this.charge01 = 0;
      this.swingTimer = 0.24;
      this.hasPossession = false;
      this.reacquireCooldown = 0.26;

      const targetPoint = this.getAimGoalPoint(input.aimNormX, input.aimNormY, input.liftedShotMode);
      const dirX = targetPoint.x - ballPos.x;
      const dirZ = targetPoint.z - ballPos.z;
      const horizDist = Math.max(0.5, Math.hypot(dirX, dirZ));
      const distanceBoost = clamp((horizDist - 9.0) / 14.0, 0, 1) * 5.5;
      const baseSpeed =
        (input.liftedShotMode ? 14.5 + power * 10.0 : 16.5 + power * 13.5) + distanceBoost;

      // Launch ball vector directly along physical ballistic path
      const flightTime = horizDist / baseSpeed;
      const dirY = targetPoint.y - ballPos.y;
      const vy = dirY / flightTime + 0.5 * FIH.GRAVITY * flightTime;

      ballVel.x = (dirX / horizDist) * baseSpeed;
      ballVel.z = (dirZ / horizDist) * baseSpeed;
      ballVel.y = input.liftedShotMode ? clamp(vy, 1.2, 8.8) : clamp(vy, 0.0, 1.6);

      onDribbleTouch(ballPos);
      onShotReleased({
        targetPoint,
        speedMps: Math.hypot(ballVel.x, ballVel.y, ballVel.z),
        isLifted: input.liftedShotMode,
        power01: power,
      });
    } else if (!input.chargingShot) {
      this.wasCharging = false;
      this.charge01 = Math.max(0, this.charge01 - dt * 3.0);
    }
  }
}
