export interface SoundVolumeSettings {
  master: number;
  effects: number;
  crowd: number;
  whistle: number;
  quietEventPreset: boolean;
}

export class SoundManager {
  private ctx: AudioContext | null = null;
  private volumes: SoundVolumeSettings = {
    master: 0.75,
    effects: 0.85,
    crowd: 0.65,
    whistle: 0.85,
    quietEventPreset: false,
  };
  private onCaption?: (caption: string) => void;
  private lastFootstepTime = 0;

  constructor(onCaption?: (caption: string) => void) {
    this.onCaption = onCaption;
  }

  public unlock(): void {
    if (!this.ctx && typeof window !== 'undefined' && window.AudioContext) {
      this.ctx = new window.AudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setVolumes(next: Partial<SoundVolumeSettings>): void {
    this.volumes = { ...this.volumes, ...next };
  }

  public getVolumes(): SoundVolumeSettings {
    return { ...this.volumes };
  }

  private effectiveGain(channel: 'effects' | 'crowd' | 'whistle'): number {
    const quietScale = this.volumes.quietEventPreset ? 0.35 : 1.0;
    return this.volumes.master * this.volumes[channel] * quietScale;
  }

  private emitCaption(text: string): void {
    this.onCaption?.(text);
  }

  public playWhistle(shortBurst: boolean = false): void {
    this.emitCaption(shortBurst ? '[Whistle: Peep]' : '[Umpire Whistle — Clock Started]');
    if (!this.ctx) return;
    const gAmt = this.effectiveGain('whistle');
    if (gAmt <= 0.005) return;

    const now = this.ctx.currentTime;
    const dur = shortBurst ? 0.14 : 0.28;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const peaLfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(2860, now);
    osc2.frequency.setValueAtTime(3010, now);

    // Classic pea-whistle warble
    peaLfo.frequency.setValueAtTime(42, now);
    lfoGain.gain.setValueAtTime(95, now);
    peaLfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.24 * gAmt, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    peaLfo.start(now);
    osc1.stop(now + dur);
    osc2.stop(now + dur);
    peaLfo.stop(now + dur);
  }

  public playStickStrike(power01: number, isLifted: boolean): void {
    this.emitCaption(
      isLifted
        ? '[Lifted Flick Contact]'
        : power01 > 0.55
          ? '[Sharp Composite Stick Strike]'
          : '[Stick Touch]',
    );
    if (!this.ctx) return;
    const gAmt = this.effectiveGain('effects');
    if (gAmt <= 0.005) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = isLifted ? 540 : 420 + power01 * 260;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);

    const amp = (0.14 + power01 * 0.28) * gAmt;
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
    this.triggerNoiseBurst(0.045, 2200, 0.16 * gAmt * (0.4 + power01));
  }

  public playKeeperPadSave(): void {
    this.emitCaption('[Foam Pad Save]');
    if (!this.ctx) return;
    const gAmt = this.effectiveGain('effects');
    if (gAmt <= 0.005) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.14);

    gain.gain.setValueAtTime(0.36 * gAmt, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
    this.triggerNoiseBurst(0.07, 650, 0.18 * gAmt);
  }

  public playPostClang(): void {
    this.emitCaption('[Steel Goalpost Clang!]');
    if (!this.ctx) return;
    const gAmt = this.effectiveGain('effects');
    if (gAmt <= 0.005) return;

    const now = this.ctx.currentTime;
    for (const freq of [780, 1210, 1930]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.14 * gAmt, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.44);
    }
  }

  public playBackboardBoom(): void {
    this.emitCaption('[Goal Backboard Thump!]');
    if (!this.ctx) return;
    const gAmt = this.effectiveGain('effects');
    if (gAmt <= 0.005) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);
    gain.gain.setValueAtTime(0.45 * gAmt, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playTurfFootstep(nowMs: number, speedMps: number): void {
    if (!this.ctx || speedMps < 1.2) return;
    const stepInterval = Math.max(210, 420 - speedMps * 22);
    if (nowMs - this.lastFootstepTime < stepInterval) return;
    this.lastFootstepTime = nowMs;
    const gAmt = this.effectiveGain('effects');
    if (gAmt <= 0.005) return;
    this.triggerNoiseBurst(0.035, 950, 0.055 * gAmt);
  }

  public playCrowdReaction(isGoal: boolean): void {
    this.emitCaption(isGoal ? '[Crowd Cheers — GOAL!]' : '[Crowd Reaction]');
    if (!this.ctx) return;
    const gAmt = this.effectiveGain('crowd');
    if (gAmt <= 0.005) return;
    this.triggerNoiseBurst(isGoal ? 1.1 : 0.55, isGoal ? 1400 : 750, (isGoal ? 0.22 : 0.12) * gAmt);
  }

  private triggerNoiseBurst(durationSec: number, centerHz: number, peakGain: number): void {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const len = Math.floor(sampleRate * durationSec);
    const buf = this.ctx.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerHz;
    filter.Q.value = 1.2;

    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peakGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(now);
    src.stop(now + durationSec);
  }
}
