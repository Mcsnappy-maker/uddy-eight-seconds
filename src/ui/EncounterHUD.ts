import { ControlScheme, DifficultyPreset } from '../rules/RulesConfig';
import { AttemptPhase, AttemptResult } from '../rules/ShootoutAdjudicator';
import { LightingPreset, QualityTier, RendererBackend } from '../rendering/EngineManager';
import { AttackerVariant } from '../rendering/AthleteModels';
import { CameraViewMode } from '../camera/GameplayCamera';

export interface HUDCallbacks {
  onStartAttempt: () => void;
  onRetryAttempt: () => void;
  onToggleReplay: () => void;
  onDifficultyChange: (d: DifficultyPreset) => void;
  onControlSchemeChange: (c: ControlScheme) => void;
  onVariantChange: (v: AttackerVariant) => void;
  onCameraModeChange: (m: CameraViewMode) => void;
  onLightingChange: (l: LightingPreset) => void;
  onQualityChange: (q: QualityTier) => void;
  onRendererSwitch: (r: RendererBackend) => void;
  onToggleBallHalo: (enabled: boolean) => void;
  onToggleQuietEvent: (quiet: boolean) => void;
  onToggleReducedMotion: (reduced: boolean) => void;
  onToggleLargeText: (large: boolean) => void;
}

export class EncounterHUD {
  private readonly root: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly circleStatusEl: HTMLElement;
  private readonly powerFillEl: HTMLElement;
  private readonly shotTypeEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly bannerTitleEl: HTMLElement;
  private readonly bannerReasonEl: HTMLElement;
  private readonly bannerMetaEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly telemetryEl: HTMLElement;
  private readonly attractOverlayEl: HTMLElement;
  private readonly replayControlsEl: HTMLElement;
  private readonly settingsDrawerEl: HTMLElement;
  private captionTimeout: number | null = null;

  constructor(container: HTMLElement, callbacks: HUDCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'uddy-hud';
    this.root.innerHTML = `
      <header class="hud-topbar">
        <div class="club-brand">
          <span class="club-pill">UDDINGSTON HOCKEY CLUB</span>
          <span class="title-label">UDDY: EIGHT SECONDS</span>
          <span class="provisional-tag" title="Provisional club blue/gold styling & fictional athletes pending approved club brand kit.">Provisional Visuals</span>
        </div>

        <div class="clock-cluster" aria-live="polite">
          <div class="clock-value" id="hud-timer">8.00</div>
          <div class="clock-sub" id="hud-circle-badge">OUTSIDE CIRCLE — DRIVE IN</div>
        </div>

        <div class="tech-badges">
          <span class="telemetry-pill" id="hud-telemetry">Init...</span>
          <button class="hud-btn" id="btn-settings" type="button">Settings & Views</button>
        </div>
      </header>

      <aside class="settings-drawer hidden" id="settings-drawer">
        <h3>Encounter Controls & Inspection</h3>
        <div class="setting-row">
          <label for="sel-diff">Keeper Difficulty</label>
          <select id="sel-diff">
            <option value="first_go">First Go (Welcoming)</option>
            <option value="club_challenge" selected>Club Challenge</option>
            <option value="cup_pressure">Cup Pressure</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-controls">Control Mode</label>
          <select id="sel-controls">
            <option value="standard" selected>Standard (WASD + Mouse Aim/Shoot)</option>
            <option value="simplified">Simplified (1-Button + Lane)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-variant">Attacker Variant</label>
          <select id="sel-variant">
            <option value="variant_a" selected>Fictional Attacker #9</option>
            <option value="variant_b">Fictional Attacker #11</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-camera">Camera View</label>
          <select id="sel-camera">
            <option value="gameplay" selected>Gameplay Trailing</option>
            <option value="athlete_closeup">Athlete Grip Close-Up</option>
            <option value="keeper_closeup">Keeper Kit Close-Up</option>
            <option value="broadcast_gantry">Uddy TV Gantry</option>
            <option value="behind_goal">Behind Goal</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-lighting">Lighting Preset</label>
          <select id="sel-lighting">
            <option value="floodlit" selected>Floodlit Evening Hero</option>
            <option value="daylight">Diffuse Daylight (Material Check)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-quality">Graphics Tier</label>
          <select id="sel-quality">
            <option value="showcase" selected>Showcase (PCF Shadows + Bloom)</option>
            <option value="compatible">Compatible (Reduced FX)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-renderer">Renderer Backend</label>
          <select id="sel-renderer">
            <option value="webgpu">WebGPU (Primary)</option>
            <option value="webgl2">WebGL2 (Fallback)</option>
          </select>
        </div>
        <div class="setting-checks">
          <label><input type="checkbox" id="chk-halo" /> Ball Visibility Marker</label>
          <label><input type="checkbox" id="chk-quiet" /> Quiet Event Audio</label>
          <label><input type="checkbox" id="chk-motion" /> Reduced Motion</label>
          <label><input type="checkbox" id="chk-large" /> Large Accessible Text</label>
        </div>
        <p class="rules-footnote">Rules Profile: FIH 2027 Outdoor Draft (Scottish variation review pending). Missing assets: official club crest, measured ground scans, custom Blender meshes/mocap.</p>
      </aside>

      <div class="attract-overlay" id="attract-overlay">
        <div class="attract-card">
          <div class="attract-kicker">OUTDOOR FIELD HOCKEY SHOOT-OUT</div>
          <h1>Beat the keeper. Eight seconds.</h1>
          <p>Dribble from the 23 m line into the shooting circle, draw the keeper, and finish before the buzzer. Saves and post rebounds stay live!</p>
          <div class="controls-legend">
            <span><strong>Move:</strong> WASD / Arrows</span>
            <span><strong>Aim:</strong> Mouse</span>
            <span><strong>Drive:</strong> Hold &amp; Release Left Click</span>
            <span><strong>Lifted Flick:</strong> Hold Right Click (or F)</span>
            <span><strong>V-Drag Feint:</strong> Space</span>
          </div>
          <button class="primary-cta" id="btn-start-attempt" type="button">Start Attempt (Enter / Click)</button>
        </div>
      </div>

      <div class="result-banner hidden" id="result-banner" role="status" aria-live="assertive">
        <div class="result-outcome" id="res-title">GOAL!</div>
        <p class="result-reason" id="res-reason"></p>
        <div class="result-meta" id="res-meta"></div>
        <div class="result-actions">
          <button class="primary-cta" id="btn-retry" type="button">Try Again (R)</button>
          <button class="hud-btn" id="btn-replay" type="button">Watch Replay</button>
        </div>
      </div>

      <div class="replay-bar hidden" id="replay-bar">
        <span>REPLAY — Recorded Authoritative Encounter</span>
        <button class="hud-btn" id="btn-skip-replay" type="button">Skip Replay (R)</button>
      </div>

      <footer class="hud-bottom">
        <div class="shot-meter-wrap">
          <span id="shot-type-label">GROUND DRIVE (Left Click)</span>
          <div class="shot-meter-track"><div class="shot-meter-fill" id="shot-power-fill"></div></div>
        </div>
        <div class="caption-pill" id="hud-caption">Ready on the 23 m line</div>
        <div class="quick-actions">
          <button class="hud-btn" id="btn-quick-retry" type="button">Reset Attempt (R)</button>
        </div>
      </footer>
    `;

    container.appendChild(this.root);

    this.timerEl = this.root.querySelector('#hud-timer')!;
    this.circleStatusEl = this.root.querySelector('#hud-circle-badge')!;
    this.powerFillEl = this.root.querySelector('#shot-power-fill')!;
    this.shotTypeEl = this.root.querySelector('#shot-type-label')!;
    this.bannerEl = this.root.querySelector('#result-banner')!;
    this.bannerTitleEl = this.root.querySelector('#res-title')!;
    this.bannerReasonEl = this.root.querySelector('#res-reason')!;
    this.bannerMetaEl = this.root.querySelector('#res-meta')!;
    this.captionEl = this.root.querySelector('#hud-caption')!;
    this.telemetryEl = this.root.querySelector('#hud-telemetry')!;
    this.attractOverlayEl = this.root.querySelector('#attract-overlay')!;
    this.replayControlsEl = this.root.querySelector('#replay-bar')!;
    this.settingsDrawerEl = this.root.querySelector('#settings-drawer')!;

    // Event bindings
    this.root.querySelector('#btn-start-attempt')!.addEventListener('click', callbacks.onStartAttempt);
    this.root.querySelector('#btn-retry')!.addEventListener('click', callbacks.onRetryAttempt);
    this.root.querySelector('#btn-quick-retry')!.addEventListener('click', callbacks.onRetryAttempt);
    this.root.querySelector('#btn-replay')!.addEventListener('click', callbacks.onToggleReplay);
    this.root.querySelector('#btn-skip-replay')!.addEventListener('click', callbacks.onToggleReplay);
    this.root.querySelector('#btn-settings')!.addEventListener('click', () => {
      this.settingsDrawerEl.classList.toggle('hidden');
    });

    (this.root.querySelector('#sel-diff') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onDifficultyChange((e.target as HTMLSelectElement).value as DifficultyPreset);
    });
    (this.root.querySelector('#sel-controls') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onControlSchemeChange((e.target as HTMLSelectElement).value as ControlScheme);
    });
    (this.root.querySelector('#sel-variant') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onVariantChange((e.target as HTMLSelectElement).value as AttackerVariant);
    });
    (this.root.querySelector('#sel-camera') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onCameraModeChange((e.target as HTMLSelectElement).value as CameraViewMode);
    });
    (this.root.querySelector('#sel-lighting') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onLightingChange((e.target as HTMLSelectElement).value as LightingPreset);
    });
    (this.root.querySelector('#sel-quality') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onQualityChange((e.target as HTMLSelectElement).value as QualityTier);
    });
    (this.root.querySelector('#sel-renderer') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onRendererSwitch((e.target as HTMLSelectElement).value as RendererBackend);
    });
    (this.root.querySelector('#chk-halo') as HTMLInputElement).addEventListener('change', (e) => {
      callbacks.onToggleBallHalo((e.target as HTMLInputElement).checked);
    });
    (this.root.querySelector('#chk-quiet') as HTMLInputElement).addEventListener('change', (e) => {
      callbacks.onToggleQuietEvent((e.target as HTMLInputElement).checked);
    });
    (this.root.querySelector('#chk-motion') as HTMLInputElement).addEventListener('change', (e) => {
      callbacks.onToggleReducedMotion((e.target as HTMLInputElement).checked);
    });
    (this.root.querySelector('#chk-large') as HTMLInputElement).addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.root.classList.toggle('large-text', checked);
      callbacks.onToggleLargeText(checked);
    });
  }

  public syncBackendSelection(backend: RendererBackend): void {
    const sel = this.root.querySelector('#sel-renderer') as HTMLSelectElement;
    if (sel) sel.value = backend;
  }

  public syncDropdowns(opts: {
    camera?: CameraViewMode;
    lighting?: LightingPreset;
    quality?: QualityTier;
  }): void {
    if (opts.camera) (this.root.querySelector('#sel-camera') as HTMLSelectElement).value = opts.camera;
    if (opts.lighting) (this.root.querySelector('#sel-lighting') as HTMLSelectElement).value = opts.lighting;
    if (opts.quality) (this.root.querySelector('#sel-quality') as HTMLSelectElement).value = opts.quality;
  }

  public setTelemetry(text: string): void {
    this.telemetryEl.textContent = text;
  }

  public showCaption(text: string): void {
    this.captionEl.textContent = text;
    if (this.captionTimeout !== null) {
      window.clearTimeout(this.captionTimeout);
    }
    this.captionTimeout = window.setTimeout(() => {
      this.captionEl.textContent = 'Live Play';
    }, 2400);
  }

  public updateState(opts: {
    phase: AttemptPhase;
    remainingSeconds: number;
    hasValidCircleTouch: boolean;
    charge01: number;
    isLiftedMode: boolean;
    isReplaying: boolean;
    lastResult: AttemptResult | null;
  }): void {
    this.timerEl.textContent = opts.remainingSeconds.toFixed(2);
    this.timerEl.classList.toggle('urgent', opts.phase === 'Active' && opts.remainingSeconds <= 2.2);

    if (opts.hasValidCircleTouch) {
      this.circleStatusEl.textContent = 'INSIDE CIRCLE — LEGAL SHOT';
      this.circleStatusEl.classList.add('legal');
    } else {
      this.circleStatusEl.textContent = 'OUTSIDE CIRCLE — DRIVE INSIDE';
      this.circleStatusEl.classList.remove('legal');
    }

    this.powerFillEl.style.width = `${Math.round(opts.charge01 * 100)}%`;
    this.shotTypeEl.textContent = opts.isLiftedMode
      ? 'LIFTED FLICK / SCOOP (Right Click / F)'
      : 'GROUND DRIVE (Left Click)';

    this.attractOverlayEl.classList.toggle('hidden', opts.phase !== 'Ready' || opts.isReplaying);
    this.replayControlsEl.classList.toggle('hidden', !opts.isReplaying);

    if (opts.phase === 'Result' && opts.lastResult && !opts.isReplaying) {
      this.bannerEl.classList.remove('hidden');
      this.bannerEl.dataset.outcome = opts.lastResult.outcome.toLowerCase();
      this.bannerTitleEl.textContent =
        opts.lastResult.outcome === 'Goal'
          ? 'GOAL!'
          : opts.lastResult.outcome === 'Time'
            ? 'TIME EXPIRED'
            : opts.lastResult.outcome.toUpperCase();
      this.bannerReasonEl.textContent = opts.lastResult.reason;
      this.bannerMetaEl.textContent = `Time: ${opts.lastResult.elapsedSeconds.toFixed(2)}s · Saves: ${opts.lastResult.savesCount} · Peak Speed: ${(opts.lastResult.shotSpeedMps * 3.6).toFixed(0)} km/h`;
    } else {
      this.bannerEl.classList.add('hidden');
    }
  }
}
