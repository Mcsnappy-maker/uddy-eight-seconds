import { FIH, Vec3 } from '../rules/RulesConfig';

export interface OrientedBoxCollider {
  id: string;
  tag: 'post' | 'backboard' | 'keeper_kicker' | 'keeper_pad' | 'keeper_blocker' | 'keeper_stick' | 'keeper_helmet';
  center: Vec3;
  halfExtents: Vec3;
  /** Yaw rotation around Y axis in radians */
  yaw: number;
  restitution: number;
  velocity?: Vec3;
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;
  grounded: boolean;
}

export interface PhysicsCollisionHit {
  colliderId: string;
  tag: OrientedBoxCollider['tag'];
  point: Vec3;
  normal: Vec3;
  impactSpeed: number;
}

export interface PhysicsStepOutput {
  prevPos: Vec3;
  currPos: Vec3;
  speedMps: number;
  hits: PhysicsCollisionHit[];
  hitNet: boolean;
  netImpactPoint: Vec3 | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class PhysicsWorld {
  public ball: BallState;
  private readonly staticColliders: OrientedBoxCollider[] = [];
  private dynamicColliders: OrientedBoxCollider[] = [];

  constructor() {
    this.ball = {
      pos: { x: 0, y: FIH.BALL_RADIUS, z: FIH.LINE_23M_DISTANCE },
      vel: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0, z: 0 },
      grounded: true,
    };
    this.buildGoalColliders();
  }

  public resetBall(pos: Vec3 = { x: 0, y: FIH.BALL_RADIUS, z: FIH.LINE_23M_DISTANCE }): void {
    this.ball.pos = { ...pos };
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.spin = { x: 0, y: 0, z: 0 };
    this.ball.grounded = pos.y <= FIH.BALL_RADIUS + 0.002;
  }

  public setDynamicColliders(colliders: OrientedBoxCollider[]): void {
    this.dynamicColliders = colliders;
  }

  public getStaticColliders(): readonly OrientedBoxCollider[] {
    return this.staticColliders;
  }

  private buildGoalColliders(): void {
    const postHalfW = FIH.GOAL_POST_WIDTH * 0.5;
    const postHalfD = FIH.GOAL_POST_DEPTH * 0.5;
    const postCenterZ = FIH.GOAL_POST_DEPTH * 0.5; // Front edge of goal-line [0, +0.075]
    const postH = FIH.GOAL_HEIGHT + FIH.GOAL_POST_WIDTH;

    // Left post (-X) and Right post (+X)
    this.staticColliders.push(
      {
        id: 'goal_post_left',
        tag: 'post',
        center: { x: -(FIH.GOAL_HALF_WIDTH + postHalfW), y: postH * 0.5, z: postCenterZ },
        halfExtents: { x: postHalfW, y: postH * 0.5, z: postHalfD },
        yaw: 0,
        restitution: 0.72,
      },
      {
        id: 'goal_post_right',
        tag: 'post',
        center: { x: FIH.GOAL_HALF_WIDTH + postHalfW, y: postH * 0.5, z: postCenterZ },
        halfExtents: { x: postHalfW, y: postH * 0.5, z: postHalfD },
        yaw: 0,
        restitution: 0.72,
      },
      {
        id: 'goal_crossbar',
        tag: 'post',
        center: { x: 0, y: FIH.GOAL_HEIGHT + postHalfW, z: postCenterZ },
        halfExtents: { x: FIH.GOAL_HALF_WIDTH + FIH.GOAL_POST_WIDTH, y: postHalfW, z: postHalfD },
        yaw: 0,
        restitution: 0.72,
      },
    );

    // Backboard and Sideboards (0.46 m high, low restitution heavy timber/composite thud)
    const boardThickness = 0.035;
    const halfDepth = FIH.GOAL_DEPTH_BOTTOM * 0.5;
    const halfBoardH = FIH.BACKBOARD_HEIGHT * 0.5;
    this.staticColliders.push(
      {
        id: 'goal_backboard',
        tag: 'backboard',
        center: { x: 0, y: halfBoardH, z: -FIH.GOAL_DEPTH_BOTTOM - boardThickness * 0.5 },
        halfExtents: { x: FIH.GOAL_HALF_WIDTH + boardThickness, y: halfBoardH, z: boardThickness * 0.5 },
        yaw: 0,
        restitution: 0.24,
      },
      {
        id: 'goal_sideboard_left',
        tag: 'backboard',
        center: { x: -(FIH.GOAL_HALF_WIDTH + boardThickness * 0.5), y: halfBoardH, z: -halfDepth },
        halfExtents: { x: boardThickness * 0.5, y: halfBoardH, z: halfDepth },
        yaw: 0,
        restitution: 0.28,
      },
      {
        id: 'goal_sideboard_right',
        tag: 'backboard',
        center: { x: FIH.GOAL_HALF_WIDTH + boardThickness * 0.5, y: halfBoardH, z: -halfDepth },
        halfExtents: { x: boardThickness * 0.5, y: halfBoardH, z: halfDepth },
        yaw: 0,
        restitution: 0.28,
      },
    );
  }

  /**
   * Advances ball physics by dt using PHYSICS_SUBSTEPS swept-sphere substeps.
   * Ensures 40 m/s stress-test shots never tunnel past 50 mm goalposts or thin keeper sticks.
   */
  public step(dt: number): PhysicsStepOutput {
    const prevPos: Vec3 = { ...this.ball.pos };
    const substeps = FIH.PHYSICS_SUBSTEPS;
    const subDt = dt / substeps;
    const hits: PhysicsCollisionHit[] = [];
    const seenIdsThisStep = new Set<string>();
    let hitNet = false;
    let netImpactPoint: Vec3 | null = null;

    const allColliders = [...this.staticColliders, ...this.dynamicColliders];

    for (let s = 0; s < substeps; s += 1) {
      // Gravity & air drag
      if (!this.ball.grounded || this.ball.pos.y > FIH.BALL_RADIUS + 0.001) {
        this.ball.vel.y -= FIH.GRAVITY * subDt;
        const airDrag = Math.exp(-0.18 * subDt);
        this.ball.vel.x *= airDrag;
        this.ball.vel.y *= airDrag;
        this.ball.vel.z *= airDrag;
      } else {
        // Wet synthetic water-based turf rolling resistance
        const speedHoriz = Math.hypot(this.ball.vel.x, this.ball.vel.z);
        if (speedHoriz > 0.001) {
          const decel = 1.85 * subDt;
          const nextSpeed = Math.max(0, speedHoriz - decel);
          const scale = nextSpeed / speedHoriz;
          this.ball.vel.x *= scale;
          this.ball.vel.z *= scale;
        } else {
          this.ball.vel.x = 0;
          this.ball.vel.z = 0;
        }
      }

      // Integrate position
      this.ball.pos.x += this.ball.vel.x * subDt;
      this.ball.pos.y += this.ball.vel.y * subDt;
      this.ball.pos.z += this.ball.vel.z * subDt;

      // Ground plane bounce & contact
      if (this.ball.pos.y <= FIH.BALL_RADIUS) {
        this.ball.pos.y = FIH.BALL_RADIUS;
        if (this.ball.vel.y < -0.65) {
          this.ball.vel.y = -this.ball.vel.y * 0.42;
          this.ball.grounded = false;
        } else {
          this.ball.vel.y = 0;
          this.ball.grounded = true;
        }
      } else if (this.ball.pos.y > FIH.BALL_RADIUS + 0.004) {
        this.ball.grounded = false;
      }

      // Sphere-vs-OBB collisions across all colliders
      for (const box of allColliders) {
        const hit = this.resolveSphereOBB(box);
        if (hit && !seenIdsThisStep.has(box.id)) {
          seenIdsThisStep.add(box.id);
          hits.push(hit);
        }
      }

      // Soft upper/rear goal net containment (above backboard height y > 0.46)
      if (
        this.ball.pos.z < 0 &&
        Math.abs(this.ball.pos.x) <= FIH.GOAL_HALF_WIDTH + 0.05 &&
        this.ball.pos.y <= FIH.GOAL_HEIGHT
      ) {
        // Tapered net depth from 1.20m at ground to 0.90m at crossbar
        const heightRatio = clamp(this.ball.pos.y / FIH.GOAL_HEIGHT, 0, 1);
        const netBackZ = -(
          FIH.GOAL_DEPTH_BOTTOM * (1 - heightRatio) +
          FIH.GOAL_DEPTH_TOP * heightRatio
        );
        if (this.ball.pos.z - FIH.BALL_RADIUS < netBackZ && this.ball.pos.y > FIH.BACKBOARD_HEIGHT) {
          this.ball.pos.z = netBackZ + FIH.BALL_RADIUS;
          this.ball.vel.z = Math.abs(this.ball.vel.z) * 0.14;
          this.ball.vel.x *= 0.4;
          this.ball.vel.y *= 0.4;
          hitNet = true;
          netImpactPoint = { ...this.ball.pos };
        }
        // Net roof
        if (this.ball.pos.y + FIH.BALL_RADIUS > FIH.GOAL_HEIGHT && this.ball.pos.z < -0.05) {
          this.ball.pos.y = FIH.GOAL_HEIGHT - FIH.BALL_RADIUS;
          this.ball.vel.y = -Math.abs(this.ball.vel.y) * 0.15;
          hitNet = true;
          netImpactPoint = { ...this.ball.pos };
        }
        // Side netting above backboard
        if (this.ball.pos.y > FIH.BACKBOARD_HEIGHT && this.ball.pos.z < -0.08) {
          if (this.ball.pos.x - FIH.BALL_RADIUS < -FIH.GOAL_HALF_WIDTH) {
            this.ball.pos.x = -FIH.GOAL_HALF_WIDTH + FIH.BALL_RADIUS;
            this.ball.vel.x = Math.abs(this.ball.vel.x) * 0.15;
            hitNet = true;
            netImpactPoint = { ...this.ball.pos };
          } else if (this.ball.pos.x + FIH.BALL_RADIUS > FIH.GOAL_HALF_WIDTH) {
            this.ball.pos.x = FIH.GOAL_HALF_WIDTH - FIH.BALL_RADIUS;
            this.ball.vel.x = -Math.abs(this.ball.vel.x) * 0.15;
            hitNet = true;
            netImpactPoint = { ...this.ball.pos };
          }
        }
      }
    }

    const speedMps = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);
    return {
      prevPos,
      currPos: { ...this.ball.pos },
      speedMps,
      hits,
      hitNet,
      netImpactPoint,
    };
  }

  private resolveSphereOBB(box: OrientedBoxCollider): PhysicsCollisionHit | null {
    const dx = this.ball.pos.x - box.center.x;
    const dy = this.ball.pos.y - box.center.y;
    const dz = this.ball.pos.z - box.center.z;

    const cosY = Math.cos(-box.yaw);
    const sinY = Math.sin(-box.yaw);
    const lx = dx * cosY - dz * sinY;
    const ly = dy;
    const lz = dx * sinY + dz * cosY;

    const cx = clamp(lx, -box.halfExtents.x, box.halfExtents.x);
    const cy = clamp(ly, -box.halfExtents.y, box.halfExtents.y);
    const cz = clamp(lz, -box.halfExtents.z, box.halfExtents.z);

    let nxLocal = lx - cx;
    let nyLocal = ly - cy;
    let nzLocal = lz - cz;
    const distSq = nxLocal * nxLocal + nyLocal * nyLocal + nzLocal * nzLocal;

    if (distSq > FIH.BALL_RADIUS * FIH.BALL_RADIUS) {
      return null;
    }

    let dist = Math.sqrt(distSq);
    if (dist < 1e-6) {
      // Sphere center is inside OBB: push out along nearest face
      const px = box.halfExtents.x - Math.abs(lx);
      const py = box.halfExtents.y - Math.abs(ly);
      const pz = box.halfExtents.z - Math.abs(lz);
      if (px <= py && px <= pz) {
        nxLocal = lx >= 0 ? 1 : -1;
        nyLocal = 0;
        nzLocal = 0;
        dist = -px;
      } else if (py <= px && py <= pz) {
        nxLocal = 0;
        nyLocal = ly >= 0 ? 1 : -1;
        nzLocal = 0;
        dist = -py;
      } else {
        nxLocal = 0;
        nyLocal = 0;
        nzLocal = lz >= 0 ? 1 : -1;
        dist = -pz;
      }
    } else {
      nxLocal /= dist;
      nyLocal /= dist;
      nzLocal /= dist;
    }

    // Rotate normal back to world space
    const cosW = Math.cos(box.yaw);
    const sinW = Math.sin(box.yaw);
    const nx = nxLocal * cosW - nzLocal * sinW;
    const ny = nyLocal;
    const nz = nxLocal * sinW + nzLocal * cosW;

    const penetration = FIH.BALL_RADIUS - dist;
    this.ball.pos.x += nx * penetration;
    this.ball.pos.y += ny * penetration;
    this.ball.pos.z += nz * penetration;
    if (this.ball.pos.y < FIH.BALL_RADIUS) {
      this.ball.pos.y = FIH.BALL_RADIUS;
    }

    const boxVel = box.velocity ?? { x: 0, y: 0, z: 0 };
    const relVx = this.ball.vel.x - boxVel.x;
    const relVy = this.ball.vel.y - boxVel.y;
    const relVz = this.ball.vel.z - boxVel.z;
    const velAlongNormal = relVx * nx + relVy * ny + relVz * nz;

    if (velAlongNormal < 0) {
      const e = box.restitution;
      const j = -(1 + e) * velAlongNormal;
      this.ball.vel.x += j * nx;
      this.ball.vel.y += j * ny;
      this.ball.vel.z += j * nz;
      // Add slight keeper clearance energy when kicked/deflected by keeper pads
      if (box.tag === 'keeper_kicker' || box.tag === 'keeper_stick') {
        this.ball.vel.z += Math.max(0, nz) * 1.4;
      }
    }

    return {
      colliderId: box.id,
      tag: box.tag,
      point: {
        x: this.ball.pos.x - nx * FIH.BALL_RADIUS,
        y: this.ball.pos.y - ny * FIH.BALL_RADIUS,
        z: this.ball.pos.z - nz * FIH.BALL_RADIUS,
      },
      normal: { x: nx, y: ny, z: nz },
      impactSpeed: Math.abs(velAlongNormal),
    };
  }
}
