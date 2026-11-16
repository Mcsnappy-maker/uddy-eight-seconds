import { FreeCamera, Scene, Vector3 } from '@babylonjs/core';
import { Vec3 } from '../rules/RulesConfig';

export type CameraViewMode =
  | 'title_screen'
  | 'gameplay'
  | 'athlete_closeup'
  | 'keeper_closeup'
  | 'broadcast_gantry'
  | 'behind_goal';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class GameplayCamera {
  public readonly camera: FreeCamera;
  public mode: CameraViewMode = 'gameplay';
  private currentPos = new Vector3(0, 3.2, 27.8);
  private currentTarget = new Vector3(0, 0.85, 0);

  constructor(scene: Scene) {
    this.camera = new FreeCamera('main_cam', this.currentPos.clone(), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 220;
    this.camera.fov = 0.82; // ~47 deg wide broadcast framing (shows full athlete + keeper + goal)
    this.camera.setTarget(this.currentTarget);
  }

  public setMode(mode: CameraViewMode): void {
    this.mode = mode;
  }

  public updateTitleCamera(
    dt: number,
    elapsedTime: number,
    allowIdleMotion: boolean,
    snapImmediately: boolean = false,
  ): void {
    const desiredPos = allowIdleMotion
      ? new Vector3(
          Math.sin(elapsedTime * 0.25) * 2.1,
          2.75 + Math.cos(elapsedTime * 0.18) * 0.1,
          17.8,
        )
      : new Vector3(0, 2.75, 17.8);
    const desiredTarget = new Vector3(0, 0.95, 1.2);

    const alpha = snapImmediately || !allowIdleMotion ? 1.0 : 1 - Math.exp(-3.5 * dt);
    this.currentPos.set(
      lerp(this.currentPos.x, desiredPos.x, alpha),
      lerp(this.currentPos.y, desiredPos.y, alpha),
      lerp(this.currentPos.z, desiredPos.z, alpha),
    );
    this.currentTarget.set(
      lerp(this.currentTarget.x, desiredTarget.x, alpha),
      lerp(this.currentTarget.y, desiredTarget.y, alpha),
      lerp(this.currentTarget.z, desiredTarget.z, alpha),
    );

    this.camera.position.copyFrom(this.currentPos);
    this.camera.setTarget(this.currentTarget);
  }

  public update(
    dt: number,
    attackerPos: Vec3,
    keeperPos: Vec3,
    ballPos: Vec3,
    snapImmediately: boolean = false,
  ): void {
    let desiredPos: Vector3;
    let desiredTarget: Vector3;

    if (this.mode === 'athlete_closeup') {
      // Front-right 3/4 inspection showing full head/face, hair, two-handed separated grip on carbon stick, kit, socks, and turf shoes
      desiredPos = new Vector3(attackerPos.x - 1.35, 1.02, attackerPos.z - 2.75);
      desiredTarget = new Vector3(attackerPos.x, 0.88, attackerPos.z + 0.05);
    } else if (this.mode === 'keeper_closeup') {
      // Unobstructed front-quarter close-up of human face inside helmet cage, fitted smock, leg guards, kickers, flat left blocker & stick
      desiredPos = new Vector3(keeperPos.x - 0.85, 1.04, keeperPos.z + 2.55);
      desiredTarget = new Vector3(keeperPos.x, 0.90, keeperPos.z);
    } else if (this.mode === 'broadcast_gantry') {
      // Uddy TV elevated sideline view
      desiredPos = new Vector3(17.5, 6.2, 11.5);
      desiredTarget = new Vector3(ballPos.x * 0.4, 0.8, Math.min(16, ballPos.z * 0.55));
    } else if (this.mode === 'behind_goal') {
      // Behind goal netting view showing keeper angles and incoming strike
      desiredPos = new Vector3(0.45, 1.75, -3.5);
      desiredTarget = new Vector3(ballPos.x * 0.7, 0.9, Math.max(1.0, ballPos.z * 0.65));
    } else {
      // Elevated trailing gameplay camera keeping full attacker, ball, stick, keeper & goal readable
      const camZ = Math.max(4.4, attackerPos.z + 5.9);
      const camX = attackerPos.x * 0.62;
      const camY = 2.45 + Math.max(0, attackerPos.z - 6) * 0.02;
      desiredPos = new Vector3(camX, camY, camZ);

      const lookZ = Math.min(attackerPos.z - 4.0, Math.max(-0.2, ballPos.z * 0.45));
      desiredTarget = new Vector3(ballPos.x * 0.35, 0.62, lookZ);
    }

    const alpha = snapImmediately ? 1.0 : 1 - Math.exp(-8.5 * dt);
    this.currentPos.set(
      lerp(this.currentPos.x, desiredPos.x, alpha),
      lerp(this.currentPos.y, desiredPos.y, alpha),
      lerp(this.currentPos.z, desiredPos.z, alpha),
    );
    this.currentTarget.set(
      lerp(this.currentTarget.x, desiredTarget.x, alpha),
      lerp(this.currentTarget.y, desiredTarget.y, alpha),
      lerp(this.currentTarget.z, desiredTarget.z, alpha),
    );

    this.camera.position.copyFrom(this.currentPos);
    this.camera.setTarget(this.currentTarget);
  }
}
