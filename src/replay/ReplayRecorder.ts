import { Vec3 } from '../rules/RulesConfig';

export interface ReplayFrame {
  timeSeconds: number;
  ballPos: Vec3;
  attackerPos: Vec3;
  attackerYaw: number;
  attackerSpeed: number;
  attackerSwing: number;
  keeperPos: Vec3;
  keeperYaw: number;
  keeperPose: string;
  keeperSaveProgress: number;
}

export class ReplayRecorder {
  private readonly maxFrames = 1400; // ~11.6s at 120Hz
  private frames: ReplayFrame[] = [];

  public clear(): void {
    this.frames = [];
  }

  public record(frame: ReplayFrame): void {
    if (this.frames.length >= this.maxFrames) {
      this.frames.shift();
    }
    this.frames.push({
      ...frame,
      ballPos: { ...frame.ballPos },
      attackerPos: { ...frame.attackerPos },
      keeperPos: { ...frame.keeperPos },
    });
  }

  public getFrameCount(): number {
    return this.frames.length;
  }

  public getDuration(): number {
    if (this.frames.length === 0) return 0;
    return this.frames[this.frames.length - 1].timeSeconds;
  }

  public sampleAt(timeSeconds: number): ReplayFrame | null {
    if (this.frames.length === 0) return null;
    if (timeSeconds <= this.frames[0].timeSeconds) return this.frames[0];
    const last = this.frames[this.frames.length - 1];
    if (timeSeconds >= last.timeSeconds) return last;

    // Binary search for frame bracket
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].timeSeconds <= timeSeconds) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const a = this.frames[lo];
    const b = this.frames[hi];
    const span = Math.max(1e-6, b.timeSeconds - a.timeSeconds);
    const t = Math.max(0, Math.min(1, (timeSeconds - a.timeSeconds) / span));

    const lerp = (u: number, v: number): number => u + (v - u) * t;
    return {
      timeSeconds,
      ballPos: {
        x: lerp(a.ballPos.x, b.ballPos.x),
        y: lerp(a.ballPos.y, b.ballPos.y),
        z: lerp(a.ballPos.z, b.ballPos.z),
      },
      attackerPos: {
        x: lerp(a.attackerPos.x, b.attackerPos.x),
        y: lerp(a.attackerPos.y, b.attackerPos.y),
        z: lerp(a.attackerPos.z, b.attackerPos.z),
      },
      attackerYaw: lerp(a.attackerYaw, b.attackerYaw),
      attackerSpeed: lerp(a.attackerSpeed, b.attackerSpeed),
      attackerSwing: lerp(a.attackerSwing, b.attackerSwing),
      keeperPos: {
        x: lerp(a.keeperPos.x, b.keeperPos.x),
        y: lerp(a.keeperPos.y, b.keeperPos.y),
        z: lerp(a.keeperPos.z, b.keeperPos.z),
      },
      keeperYaw: lerp(a.keeperYaw, b.keeperYaw),
      keeperPose: t < 0.5 ? a.keeperPose : b.keeperPose,
      keeperSaveProgress: lerp(a.keeperSaveProgress, b.keeperSaveProgress),
    };
  }
}
