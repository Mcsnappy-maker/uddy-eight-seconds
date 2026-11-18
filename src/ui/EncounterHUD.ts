import { ControlScheme, DifficultyPreset } from '../rules/RulesConfig';
import { AttemptPhase, AttemptResult } from '../rules/ShootoutAdjudicator';
import { LightingPreset, QualityTier, RendererBackend } from '../rendering/EngineManager';
import { AttackerVariant } from '../rendering/AthleteModels';
import { CameraViewMode } from '../camera/GameplayCamera';
import { getOrderedPartnerLogos, PartnerLogoConfig } from '../config/PartnerLogosConfig';

export type GameMode = 'free_play' | 'shootout_8s';

export type PracticeSpot = 'top_d' | 'penalty_spot' | 'wing_angle' | 'line_23m';

export type InputDeviceKind = 'keyboard' | 'gamepad' | 'touch';

export interface FreePlayStats {
  goalsScored: number;
  keeperSaves: number;
  currentStreak: number;
}

export interface HUDCallbacks {
  onPlayFromTitle: () => void;
  onReturnToTitle: () => void;
  onStartAttempt: () => void;
  onRetryAttempt: () => void;
  onUnlockSetupByRestart: () => void;
  onToggleReplay: () => void;
  onGameModeChange: (mode: GameMode) => void;
  onPracticeSpotSelect: (spot: PracticeSpot) => void;
  onCallBallToStick: () => void;
  onShootHoldStart: (lifted: boolean) => void;
  onShootHoldEnd: (lifted: boolean) => void;
  onTouchMoveUpdate: (moveX: number, moveZ: number) => void;
  onTouchAimDelta: (dxNorm: number, dyNorm: number) => void;
  onTouchFeint: () => void;
  onResolutionScaleChange: (scale: number) => void;
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

const INPUT_HINTS_TEXT: Record<InputDeviceKind, string> = {
  keyboard:
    'Move: WASD / Arrows  ·  Aim: Mouse or A/D  ·  Ground hit: Space / Left click  ·  Lifted flick: F / Right click  ·  Feint: E  ·  Retry: R',
  gamepad:
    'Move: Left Stick  ·  Aim: Right Stick  ·  Ground hit: A / RT  ·  Lifted flick: X  ·  Feint: B  ·  Retry: Y',
  touch:
    'Left thumb: Move  ·  Right buttons: Hold & drag to aim, release to shoot  ·  Feint: Tap Feint',
};

export class EncounterHUD {
  private readonly root: HTMLElement;
  private readonly modeTagEl: HTMLElement;
  private readonly goalsValEl: HTMLElement;
  private readonly savesValEl: HTMLElement;
  private readonly timerBlockEl: HTMLElement;
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
  private readonly devOverlayEl: HTMLElement;
  private readonly attractOverlayEl: HTMLElement;
  private readonly setupLockNoteEl: HTMLElement;
  private readonly setupSpotHintEl: HTMLElement;
  private readonly setupActionsReadyEl: HTMLElement;
  private readonly setupActionsActiveEl: HTMLElement;
  private readonly setupSpotGroupEl: HTMLElement;
  private readonly replayControlsEl: HTMLElement;
  private readonly settingsDrawerEl: HTMLElement;
  private readonly compactMenuEl: HTMLElement;
  private readonly hintsBarEl: HTMLElement;
  private readonly hintsTextEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly joystickZoneEl: HTMLElement;
  private readonly joystickKnobEl: HTMLElement;
  private readonly portraitNoticeEl: HTMLElement;
  private readonly titleScreenEl: HTMLElement;
  private readonly titlePlayBtnEl: HTMLButtonElement;
  private readonly titleLoadingWrapEl: HTMLElement;
  private readonly titleLoadingFillEl: HTMLElement;
  private readonly titleLoadingTextEl: HTMLElement;
  private readonly titleErrorBoxEl: HTMLElement;
  private readonly howToModalEl: HTMLElement;
  private readonly titlePartnersEl: HTMLElement;
  private readonly setupPartnersEl: HTMLElement;

  private captionTimeout: number | null = null;
  private toastTimeout: number | null = null;
  private hintsAutoHideTimeout: number | null = null;
  private movePointerId: number | null = null;
  private shootPointerId: number | null = null;
  private shootPointerLifted = false;
  private lastShootClientX = 0;
  private lastShootClientY = 0;
  private onTouchMoveRef!: (moveX: number, moveZ: number) => void;

  private manualSetupOpen = false;
  private howtoOpen = false;
  private onTitleScreen = true;
  private sceneLoaded = false;
  private keepHintsVisible = false;
  private userToggledHints = false;
  private firstPlayHintsShown = false;
  private devOverlayVisible = false;
  private currentInputDevice: InputDeviceKind = 'keyboard';
  private lastPhase: AttemptPhase = 'Preparing';
  private currentMode: GameMode = 'free_play';

  constructor(container: HTMLElement, callbacks: HUDCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'uddy-hud is-title-screen';
    this.root.dataset.inputDevice = 'keyboard';
    this.root.innerHTML = `
      <header class="hud-topbar">
        <div class="club-brand">
          <img class="club-crest" src="./assets/branding/uddingston_crest.png" alt="Uddingston Hockey Club castle crest" />
          <div class="brand-text">
            <span class="club-name">Uddingston HC</span>
            <span class="game-sub">Eight Seconds</span>
          </div>
        </div>

        <div class="scorebug" aria-live="polite">
          <div class="scorebug-mode">
            <span id="hud-mode-tag">Free practice</span>
            <span class="scorebug-circle hidden" id="hud-circle-badge">Enter circle</span>
          </div>
          <div class="scorebug-stats">
            <div class="stat-cell">
              <span class="stat-label">Goals</span>
              <span class="stat-num" id="hud-goals">0</span>
            </div>
            <div class="stat-divider" aria-hidden="true"></div>
            <div class="stat-cell">
              <span class="stat-label">Saves</span>
              <span class="stat-num" id="hud-saves">0</span>
            </div>
            <div class="stat-divider timer-divider hidden" aria-hidden="true"></div>
            <div class="stat-cell timer-cell hidden" id="hud-timer-block">
              <span class="stat-label">Time</span>
              <span class="stat-num timer-num" id="hud-timer">8.00</span>
            </div>
          </div>
        </div>

        <div class="hud-actions">
          <div class="hud-actions-desktop">
            <button class="hud-btn" id="btn-open-title" type="button" aria-label="Return to title screen">Title</button>
            <button class="hud-btn" id="btn-open-setup" type="button" aria-label="Session setup">Setup</button>
            <button class="hud-btn" id="btn-toggle-hints" type="button" aria-label="Toggle controls guidance">Controls</button>
            <button class="hud-btn" id="btn-settings" type="button" aria-label="Settings">Settings</button>
            <button class="hud-btn" id="btn-quick-retry" type="button" aria-label="Retry attempt">Retry</button>
          </div>
          <button class="hud-btn compact-menu-trigger" id="btn-compact-menu" type="button" aria-expanded="false" aria-controls="compact-menu">Menu</button>
          <div class="compact-menu hidden" id="compact-menu" role="menu">
            <button class="hud-btn" type="button" data-compact-action="title">Title screen</button>
            <button class="hud-btn" type="button" data-compact-action="setup">Session setup</button>
            <button class="hud-btn" type="button" data-compact-action="controls">Controls help</button>
            <button class="hud-btn" type="button" data-compact-action="settings">Settings</button>
            <button class="hud-btn" type="button" data-compact-action="retry">Retry (R)</button>
          </div>
        </div>
      </header>

      <section class="title-screen" id="title-screen" aria-label="Start screen">
        <div class="title-hero-area">
          <div class="title-card">
            <div class="title-identity">
              <img class="title-crest" src="./assets/branding/uddingston_crest_cutout.svg" alt="Uddingston Hockey Club castle crest" />
              <div class="title-club"><span>Uddingston</span><span>Hockey Club</span></div>
            </div>

            <div class="title-copy">
              <div class="title-eyebrow"><span class="title-eyebrow-rule" aria-hidden="true"></span>Outdoor field hockey</div>
              <h1 class="title-heading" aria-label="Uddy: Eight Seconds"><span class="title-heading-brand">Uddy:</span><span class="title-heading-word">Eight</span><span class="title-heading-word">Seconds</span></h1>
              <p class="title-sub">Outdoor field hockey shoot-out &amp; free practice</p>
            </div>

            <div class="title-loading" id="title-loading-wrap" aria-live="polite">
              <div class="title-loading-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="10">
                <div class="title-loading-fill" id="title-loading-fill"></div>
              </div>
              <span class="title-loading-text" id="title-loading-text">Loading 3D ground &amp; athletes...</span>
            </div>

            <div class="title-error hidden" id="title-error-box" role="alert"></div>

            <div class="title-actions">
              <button class="primary-cta title-play-btn" id="btn-title-play" type="button" disabled aria-disabled="true">Play</button>
              <div class="title-secondary-row">
                <button class="hud-btn" id="btn-title-setup" type="button">Session setup</button>
                <button class="hud-btn" id="btn-title-howto" type="button">How to play</button>
                <button class="hud-btn" id="btn-title-settings" type="button">Settings</button>
              </div>
            </div>
          </div>
        </div>

        <footer class="title-partners-footer" aria-label="Approved club partners">
          <span class="sponsors-label">Club partners</span>
          <div class="sponsors-logos" id="title-partners-logos"></div>
        </footer>
      </section>

      <div class="howto-modal hidden" id="howto-modal" role="dialog" aria-labelledby="howto-heading">
        <div class="howto-card">
          <div class="drawer-head">
            <h2 id="howto-heading">How to play</h2>
            <button class="hud-btn small-close" id="btn-close-howto" type="button" aria-label="Close how to play">Close</button>
          </div>
          <div class="howto-cols">
            <div class="howto-block">
              <h3>Controls</h3>
              <ul>
                <li><strong>Keyboard &amp; Mouse:</strong> <code>WASD</code> / Arrows move, <code>Mouse</code> (or <code>A/D</code>) aims target, hold/release <code>Space</code> or Left click for Ground hit, hold/release <code>F</code> or Right click for Lifted flick, <code>E</code> Feint, <code>R</code> Retry.</li>
                <li><strong>Controller:</strong> Left Stick move, Right Stick aim, <code>A</code>/<code>RT</code> Ground hit, <code>X</code> Lifted flick, <code>B</code> Feint, <code>Y</code> Retry.</li>
                <li><strong>Touch (Mobile &amp; Tablet):</strong> Left thumb pad moves; hold Right-side Ground hit or Lifted flick &amp; drag to aim, release to shoot.</li>
              </ul>
            </div>
            <div class="howto-block">
              <h3>Modes &amp; Rules</h3>
              <ul>
                <li><strong>Free practice:</strong> Unlimited time. Strike from any distance or practice spots (Top of circle, Penalty spot, Wing angle, 23 m line). Keeper saves stay live.</li>
                <li><strong>Shoot-out (8.00 s):</strong> Begin from the 23 m line on the whistle. Carry into the 14.63 m shooting circle before scoring within 8.00 s. Live rebounds remain active until goal, out-of-bounds, or buzzer.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="freeplay-toast hidden" id="freeplay-toast" role="status" aria-live="polite">Goal</div>

      <aside class="dev-overlay hidden" id="dev-overlay" aria-label="Developer diagnostics">
        <div class="dev-title">Developer diagnostics</div>
        <div class="dev-line" id="hud-telemetry">Initializing...</div>
        <div class="dev-note">Rules: FIH 2027 Outdoor Draft (Scottish variation review pending). Branding assets integrated from club media; athletes fictional.</div>
      </aside>

      <aside class="settings-drawer hidden" id="settings-drawer" aria-label="Settings">
        <div class="drawer-head">
          <h3>Settings</h3>
          <button class="hud-btn small-close" id="btn-close-settings" type="button" aria-label="Close settings">Close</button>
        </div>

        <div class="setting-row">
          <label for="sel-mode">Mode</label>
          <select id="sel-mode">
            <option value="free_play" selected>Free practice</option>
            <option value="shootout_8s">Shoot-out</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-diff">Keeper difficulty</label>
          <select id="sel-diff">
            <option value="first_go">First Go (Welcoming)</option>
            <option value="club_challenge" selected>Club Challenge</option>
            <option value="cup_pressure">Cup Pressure</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-controls">Control scheme</label>
          <select id="sel-controls">
            <option value="standard" selected>Standard (WASD + Mouse / Keys)</option>
            <option value="simplified">Simplified (Auto-approach + Shoot)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-variant">Player</label>
          <select id="sel-variant">
            <option value="variant_b" selected>Women's #11</option>
            <option value="variant_c">Women's #7</option>
            <option value="variant_d">Men's #10</option>
            <option value="variant_a">Men's #9</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-camera">Camera view</label>
          <select id="sel-camera">
            <option value="gameplay" selected>Gameplay trailing</option>
            <option value="athlete_closeup">Athlete close-up</option>
            <option value="keeper_closeup">Keeper close-up</option>
            <option value="broadcast_gantry">Broadcast gantry</option>
            <option value="behind_goal">Behind goal</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-lighting">Lighting</label>
          <select id="sel-lighting">
            <option value="floodlit" selected>Floodlit evening</option>
            <option value="daylight">Daylight</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-quality">Graphics quality</label>
          <select id="sel-quality">
            <option value="showcase" selected>Showcase (Shadows + Bloom)</option>
            <option value="balanced">Balanced (Mobile)</option>
            <option value="compatible">Compatible (Fast 60fps)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-res-scale">Render resolution</label>
          <select id="sel-res-scale">
            <option value="1" selected>100% (Native)</option>
            <option value="0.85">85% (Balanced)</option>
            <option value="0.7">70% (Mobile Fast)</option>
            <option value="0.5">50% (Battery Saver)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="sel-renderer">Renderer</label>
          <select id="sel-renderer">
            <option value="webgpu">WebGPU (Primary)</option>
            <option value="webgl2">WebGL2 (Fallback)</option>
          </select>
        </div>
        <div class="setting-checks">
          <label><input type="checkbox" id="chk-halo" /> Ball visibility marker</label>
          <label><input type="checkbox" id="chk-quiet" /> Quiet event audio</label>
          <label><input type="checkbox" id="chk-motion" /> Reduced motion</label>
          <label><input type="checkbox" id="chk-large" /> Large accessible text</label>
          <label><input type="checkbox" id="chk-keep-hints" /> Keep controls guidance visible</label>
          <label><input type="checkbox" id="chk-dev-overlay" /> Developer overlay (FPS / Renderer)</label>
        </div>
      </aside>

      <div class="attract-overlay hidden" id="attract-overlay" role="dialog" aria-labelledby="setup-heading">
        <div class="setup-panel">
          <div class="setup-header">
            <img class="setup-crest" src="./assets/branding/uddingston_crest.png" alt="Uddingston Hockey Club crest" />
            <div class="setup-title-wrap">
              <div class="setup-club">Uddingston Hockey Club</div>
              <h1 id="setup-heading">Session setup</h1>
            </div>
          </div>

          <div class="setup-lock-banner hidden" id="setup-lock-note">
            <span>Attempt in progress — restart attempt to change mode, player, or spot.</span>
          </div>

          <div class="setup-grid">
            <div class="setup-group">
              <span class="setup-label">Mode</span>
              <div class="choice-row">
                <button class="choice-btn active" type="button" data-mode="free_play">Free practice</button>
                <button class="choice-btn" type="button" data-mode="shootout_8s">Shoot-out</button>
              </div>
            </div>

            <div class="setup-group">
              <span class="setup-label">Player</span>
              <div class="choice-row">
                <button class="choice-btn active" type="button" data-variant="variant_b">Women's #11</button>
                <button class="choice-btn" type="button" data-variant="variant_c">Women's #7</button>
                <button class="choice-btn" type="button" data-variant="variant_d">Men's #10</button>
                <button class="choice-btn" type="button" data-variant="variant_a">Men's #9</button>
              </div>
            </div>

            <div class="setup-group" id="setup-spot-group">
              <span class="setup-label">Starting position</span>
              <div class="choice-row">
                <button class="choice-btn spot-choice active" type="button" data-spot="top_d">Top of circle (14 m)</button>
                <button class="choice-btn spot-choice" type="button" data-spot="penalty_spot">Penalty spot (6.5 m)</button>
                <button class="choice-btn spot-choice" type="button" data-spot="wing_angle">Wing angle (11 m)</button>
                <button class="choice-btn spot-choice" type="button" data-spot="line_23m">23 m line</button>
                <button class="choice-btn" id="btn-call-ball" type="button">Re-tee ball</button>
              </div>
              <p class="setup-hint hidden" id="setup-spot-hint">Shoot-out attempts always begin on the 23 m line.</p>
            </div>

            <div class="setup-group">
              <span class="setup-label">Control scheme</span>
              <div class="choice-row">
                <button class="choice-btn active" type="button" data-scheme="standard">Standard</button>
                <button class="choice-btn" type="button" data-scheme="simplified">Simplified (1-Thumb Assist)</button>
              </div>
            </div>
          </div>

          <details class="setup-rules">
            <summary>Rules &amp; mode guide</summary>
            <ul>
              <li><strong>Free practice:</strong> No time limit. Score from any distance, practice from set spots (keys 1–4 or Setup), and follow up live goalkeeper rebounds.</li>
              <li><strong>Shoot-out (FIH Outdoor):</strong> Start from the 23 m line on the whistle and beat the keeper within 8.00 s. The ball must be touched inside the 14.63 m shooting circle before entering the goal. Saves and post rebounds stay live until the buzzer or out-of-bounds.</li>
            </ul>
          </details>

          <div class="setup-actions" id="setup-actions-ready">
            <button class="hud-btn" id="btn-setup-title" type="button">Title screen</button>
            <button class="primary-cta" id="btn-start-attempt" type="button" disabled>Start session</button>
          </div>
          <div class="setup-actions hidden" id="setup-actions-active">
            <button class="primary-cta" id="btn-unlock-setup" type="button">Restart to change setup</button>
            <button class="hud-btn" id="btn-close-setup" type="button">Resume play</button>
          </div>

          <div class="sponsors-strip" aria-label="Club sponsors and partners">
            <span class="sponsors-label">Club partners</span>
            <div class="sponsors-logos" id="setup-partners-logos"></div>
          </div>
        </div>
      </div>

      <div class="result-banner hidden" id="result-banner" role="status" aria-live="assertive">
        <div class="result-outcome" id="res-title">Goal</div>
        <p class="result-reason" id="res-reason"></p>
        <div class="result-meta" id="res-meta"></div>
        <div class="result-actions">
          <button class="primary-cta" id="btn-retry" type="button">Retry (R)</button>
          <button class="hud-btn" id="btn-result-setup" type="button">Session setup</button>
          <button class="hud-btn" id="btn-replay" type="button">Replay</button>
        </div>
      </div>

      <div class="replay-bar hidden" id="replay-bar">
        <span>Replay review</span>
        <button class="hud-btn" id="btn-skip-replay" type="button">Exit replay (R)</button>
      </div>

      <div class="touch-controls-layer" aria-label="Touch controls">
        <div class="touch-joystick-zone" id="touch-joystick-zone" aria-label="Move thumb stick">
          <div class="touch-joystick-knob" id="touch-joystick-knob"></div>
          <span class="touch-zone-caption">Move</span>
        </div>

        <div class="touch-strike-zone" aria-label="Touch strike controls">
          <div class="touch-strike-subhint">Hold &amp; drag to aim · Release to shoot</div>
          <div class="touch-strike-grid">
            <button class="shoot-btn feint" id="btn-touch-feint" type="button">Feint</button>
            <button class="shoot-btn drive" id="btn-shoot-drive" type="button">Ground hit</button>
            <button class="shoot-btn flick" id="btn-shoot-flick" type="button">Lifted flick</button>
          </div>
        </div>
      </div>

      <div class="portrait-notice" id="portrait-notice" role="status">
        <span>Rotate to landscape for best thumb controls and pitch view.</span>
        <button class="hud-btn small-close" id="btn-dismiss-portrait" type="button">Dismiss</button>
      </div>

      <footer class="hud-bottom">
        <div class="shoot-cluster">
          <div class="shot-indicator">
            <span class="shot-type" id="shot-type-label">Ground hit</span>
            <div class="shot-meter-track" aria-label="Shot power"><div class="shot-meter-fill" id="shot-power-fill"></div></div>
          </div>
        </div>

        <div class="input-hints-bar hidden" id="input-hints-bar" role="note" aria-live="polite">
          <span id="input-hints-text"></span>
        </div>

        <div class="caption-toast hidden" id="hud-caption" aria-live="polite"></div>
      </footer>
    `;

    container.appendChild(this.root);

    this.onTouchMoveRef = callbacks.onTouchMoveUpdate;

    this.modeTagEl = this.root.querySelector('#hud-mode-tag')!;
    this.goalsValEl = this.root.querySelector('#hud-goals')!;
    this.savesValEl = this.root.querySelector('#hud-saves')!;
    this.timerBlockEl = this.root.querySelector('#hud-timer-block')!;
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
    this.devOverlayEl = this.root.querySelector('#dev-overlay')!;
    this.attractOverlayEl = this.root.querySelector('#attract-overlay')!;
    this.setupLockNoteEl = this.root.querySelector('#setup-lock-note')!;
    this.setupSpotHintEl = this.root.querySelector('#setup-spot-hint')!;
    this.setupActionsReadyEl = this.root.querySelector('#setup-actions-ready')!;
    this.setupActionsActiveEl = this.root.querySelector('#setup-actions-active')!;
    this.setupSpotGroupEl = this.root.querySelector('#setup-spot-group')!;
    this.replayControlsEl = this.root.querySelector('#replay-bar')!;
    this.settingsDrawerEl = this.root.querySelector('#settings-drawer')!;
    this.compactMenuEl = this.root.querySelector('#compact-menu')!;
    this.hintsBarEl = this.root.querySelector('#input-hints-bar')!;
    this.hintsTextEl = this.root.querySelector('#input-hints-text')!;
    this.toastEl = this.root.querySelector('#freeplay-toast')!;
    this.joystickZoneEl = this.root.querySelector('#touch-joystick-zone')!;
    this.joystickKnobEl = this.root.querySelector('#touch-joystick-knob')!;
    this.portraitNoticeEl = this.root.querySelector('#portrait-notice')!;
    this.titleScreenEl = this.root.querySelector('#title-screen')!;
    this.titlePlayBtnEl = this.root.querySelector('#btn-title-play') as HTMLButtonElement;
    this.titleLoadingWrapEl = this.root.querySelector('#title-loading-wrap')!;
    this.titleLoadingFillEl = this.root.querySelector('#title-loading-fill')!;
    this.titleLoadingTextEl = this.root.querySelector('#title-loading-text')!;
    this.titleErrorBoxEl = this.root.querySelector('#title-error-box')!;
    this.howToModalEl = this.root.querySelector('#howto-modal')!;
    this.titlePartnersEl = this.root.querySelector('#title-partners-logos')!;
    this.setupPartnersEl = this.root.querySelector('#setup-partners-logos')!;

    this.setPartnerLogos(getOrderedPartnerLogos());
    this.hintsTextEl.textContent = INPUT_HINTS_TEXT.keyboard;

    // Title Screen & How To Play actions
    this.titlePlayBtnEl.addEventListener('click', () => {
      if (!this.sceneLoaded) return;
      this.manualSetupOpen = false;
      this.howtoOpen = false;
      this.howToModalEl.classList.add('hidden');
      this.settingsDrawerEl.classList.add('hidden');
      callbacks.onPlayFromTitle();
    });
    this.root.querySelector('#btn-title-setup')!.addEventListener('click', () => {
      this.howtoOpen = false;
      this.howToModalEl.classList.add('hidden');
      this.settingsDrawerEl.classList.add('hidden');
      this.manualSetupOpen = true;
      this.syncOverlayVisibility();
    });
    this.root.querySelector('#btn-title-howto')!.addEventListener('click', () => {
      this.settingsDrawerEl.classList.add('hidden');
      this.manualSetupOpen = false;
      this.howtoOpen = !this.howtoOpen;
      this.howToModalEl.classList.toggle('hidden', !this.howtoOpen);
      this.syncOverlayVisibility();
    });
    this.root.querySelector('#btn-title-settings')!.addEventListener('click', () => {
      this.howtoOpen = false;
      this.howToModalEl.classList.add('hidden');
      this.settingsDrawerEl.classList.toggle('hidden');
    });
    this.root.querySelector('#btn-close-howto')!.addEventListener('click', () => {
      this.howtoOpen = false;
      this.howToModalEl.classList.add('hidden');
      this.syncOverlayVisibility();
    });

    const returnToTitle = () => {
      this.manualSetupOpen = false;
      this.howtoOpen = false;
      this.howToModalEl.classList.add('hidden');
      this.settingsDrawerEl.classList.add('hidden');
      this.compactMenuEl.classList.add('hidden');
      callbacks.onReturnToTitle();
    };
    this.root.querySelector('#btn-open-title')!.addEventListener('click', returnToTitle);
    this.root.querySelector('#btn-setup-title')!.addEventListener('click', returnToTitle);

    // Session & Replay actions
    this.root.querySelector('#btn-start-attempt')!.addEventListener('click', () => {
      this.manualSetupOpen = false;
      if (this.onTitleScreen) {
        if (!this.sceneLoaded) return;
        callbacks.onPlayFromTitle();
      } else {
        callbacks.onStartAttempt();
      }
    });
    this.root.querySelector('#btn-unlock-setup')!.addEventListener('click', () => {
      this.manualSetupOpen = true;
      callbacks.onUnlockSetupByRestart();
    });
    this.root.querySelector('#btn-close-setup')!.addEventListener('click', () => {
      this.manualSetupOpen = false;
      this.syncOverlayVisibility();
    });
    this.root.querySelector('#btn-retry')!.addEventListener('click', () => {
      this.manualSetupOpen = false;
      callbacks.onRetryAttempt();
    });
    this.root.querySelector('#btn-quick-retry')!.addEventListener('click', () => {
      this.manualSetupOpen = false;
      callbacks.onRetryAttempt();
    });
    this.root.querySelector('#btn-result-setup')!.addEventListener('click', () => {
      this.manualSetupOpen = true;
      callbacks.onUnlockSetupByRestart();
    });
    this.root.querySelector('#btn-replay')!.addEventListener('click', callbacks.onToggleReplay);
    this.root.querySelector('#btn-skip-replay')!.addEventListener('click', callbacks.onToggleReplay);
    this.root.querySelector('#btn-call-ball')!.addEventListener('click', () => {
      this.manualSetupOpen = false;
      callbacks.onCallBallToStick();
    });

    // Top-right controls
    const openSetup = () => {
      this.settingsDrawerEl.classList.add('hidden');
      this.compactMenuEl.classList.add('hidden');
      this.manualSetupOpen = !this.manualSetupOpen;
      this.syncOverlayVisibility();
    };
    const toggleHints = () => {
      this.userToggledHints = !this.userToggledHints;
      if (this.hintsAutoHideTimeout !== null) {
        window.clearTimeout(this.hintsAutoHideTimeout);
        this.hintsAutoHideTimeout = null;
      }
      this.syncHintsVisibility();
    };
    const toggleSettings = () => {
      this.compactMenuEl.classList.add('hidden');
      this.settingsDrawerEl.classList.toggle('hidden');
    };

    this.root.querySelector('#btn-open-setup')!.addEventListener('click', openSetup);
    this.root.querySelector('#btn-toggle-hints')!.addEventListener('click', toggleHints);
    this.root.querySelector('#btn-settings')!.addEventListener('click', toggleSettings);
    this.root.querySelector('#btn-close-settings')!.addEventListener('click', () => {
      this.settingsDrawerEl.classList.add('hidden');
    });

    const compactTrigger = this.root.querySelector('#btn-compact-menu') as HTMLButtonElement;
    compactTrigger.addEventListener('click', () => {
      const opening = this.compactMenuEl.classList.contains('hidden');
      this.compactMenuEl.classList.toggle('hidden', !opening);
      compactTrigger.setAttribute('aria-expanded', String(opening));
    });
    this.root.querySelectorAll<HTMLButtonElement>('button[data-compact-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.compactMenuEl.classList.add('hidden');
        compactTrigger.setAttribute('aria-expanded', 'false');
        const action = btn.dataset.compactAction;
        if (action === 'title') returnToTitle();
        else if (action === 'setup') openSetup();
        else if (action === 'controls') toggleHints();
        else if (action === 'settings') toggleSettings();
        else if (action === 'retry') {
          this.manualSetupOpen = false;
          callbacks.onRetryAttempt();
        }
      });
    });

    // Mode choice buttons
    this.root.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as GameMode;
        this.syncModeSelection(mode);
        callbacks.onGameModeChange(mode);
      });
    });

    // Variant choice buttons
    this.root.querySelectorAll<HTMLButtonElement>('button[data-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variant = btn.dataset.variant as AttackerVariant;
        this.syncVariantSelection(variant);
        callbacks.onVariantChange(variant);
      });
    });

    // Practice spot buttons
    this.root.querySelectorAll<HTMLButtonElement>('button[data-spot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const spot = btn.dataset.spot as PracticeSpot;
        this.syncPracticeSpotSelection(spot);
        this.manualSetupOpen = false;
        callbacks.onPracticeSpotSelect(spot);
      });
    });

    // Control scheme choice buttons inside Session setup
    this.root.querySelectorAll<HTMLButtonElement>('button[data-scheme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scheme = btn.dataset.scheme as ControlScheme;
        this.syncControlScheme(scheme);
        callbacks.onControlSchemeChange(scheme);
      });
    });

    this.root.querySelector('#btn-dismiss-portrait')!.addEventListener('click', () => {
      this.portraitNoticeEl.classList.add('dismissed');
    });

    // Multi-touch isolated left-thumb virtual joystick
    const updateJoystickFromPointer = (clientX: number, clientY: number) => {
      const rect = this.joystickZoneEl.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = Math.max(24, rect.width * 0.36);
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) {
        const s = maxR / dist;
        dx *= s;
        dy *= s;
      }
      this.joystickKnobEl.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      // Up (-dy) moves toward goal (+moveZ), right (+dx) moves right (+moveX)
      callbacks.onTouchMoveUpdate(dx / maxR, -dy / maxR);
    };

    this.joystickZoneEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setInputDevice('touch');
      if (this.movePointerId !== null) return;
      this.movePointerId = e.pointerId;
      try {
        this.joystickZoneEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore environments without pointer capture
      }
      updateJoystickFromPointer(e.clientX, e.clientY);
    });

    // Right-thumb feint trigger
    this.root.querySelector('#btn-touch-feint')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setInputDevice('touch');
      callbacks.onTouchFeint();
    });

    // Isolated multi-touch right-thumb strike buttons (supports hold + drag outside to aim + release)
    const bindShootButton = (el: HTMLElement, lifted: boolean) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'touch') {
          this.setInputDevice('touch');
        }
        if (this.shootPointerId !== null) return;
        this.shootPointerId = e.pointerId;
        this.shootPointerLifted = lifted;
        this.lastShootClientX = e.clientX;
        this.lastShootClientY = e.clientY;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Ignore environments without pointer capture
        }
        callbacks.onShootHoldStart(lifted);
      });
    };
    bindShootButton(this.root.querySelector('#btn-shoot-drive')!, false);
    bindShootButton(this.root.querySelector('#btn-shoot-flick')!, true);

    window.addEventListener('pointermove', (e) => {
      if (this.movePointerId !== null && e.pointerId === this.movePointerId) {
        updateJoystickFromPointer(e.clientX, e.clientY);
      }
      if (this.shootPointerId !== null && e.pointerId === this.shootPointerId) {
        const dx = e.clientX - this.lastShootClientX;
        const dy = e.clientY - this.lastShootClientY;
        this.lastShootClientX = e.clientX;
        this.lastShootClientY = e.clientY;
        const dxNorm = dx / Math.max(140, window.innerWidth * 0.24);
        const dyNorm = -dy / Math.max(110, window.innerHeight * 0.24);
        callbacks.onTouchAimDelta(dxNorm, dyNorm);
      }
    });

    const handlePointerEnd = (e: PointerEvent, isCancel: boolean) => {
      if (this.movePointerId !== null && e.pointerId === this.movePointerId) {
        this.movePointerId = null;
        this.joystickKnobEl.style.transform = 'translate(0px, 0px)';
        callbacks.onTouchMoveUpdate(0, 0);
      }
      if (this.shootPointerId !== null && e.pointerId === this.shootPointerId) {
        const wasLifted = this.shootPointerLifted;
        this.shootPointerId = null;
        if (!isCancel) {
          callbacks.onShootHoldEnd(wasLifted);
        }
      }
    };
    window.addEventListener('pointerup', (e) => handlePointerEnd(e, false));
    window.addEventListener('pointercancel', (e) => handlePointerEnd(e, true));

    // Settings drawer inputs
    (this.root.querySelector('#sel-mode') as HTMLSelectElement).addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as GameMode;
      this.syncModeSelection(mode);
      callbacks.onGameModeChange(mode);
    });
    (this.root.querySelector('#sel-diff') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onDifficultyChange((e.target as HTMLSelectElement).value as DifficultyPreset);
    });
    (this.root.querySelector('#sel-controls') as HTMLSelectElement).addEventListener('change', (e) => {
      const scheme = (e.target as HTMLSelectElement).value as ControlScheme;
      this.syncControlScheme(scheme);
      callbacks.onControlSchemeChange(scheme);
    });
    (this.root.querySelector('#sel-variant') as HTMLSelectElement).addEventListener('change', (e) => {
      const variant = (e.target as HTMLSelectElement).value as AttackerVariant;
      this.syncVariantSelection(variant);
      callbacks.onVariantChange(variant);
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
    (this.root.querySelector('#sel-res-scale') as HTMLSelectElement).addEventListener('change', (e) => {
      callbacks.onResolutionScaleChange(Number((e.target as HTMLSelectElement).value) || 1.0);
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
    (this.root.querySelector('#chk-keep-hints') as HTMLInputElement).addEventListener('change', (e) => {
      this.keepHintsVisible = (e.target as HTMLInputElement).checked;
      this.syncHintsVisibility();
    });
    (this.root.querySelector('#chk-dev-overlay') as HTMLInputElement).addEventListener('change', (e) => {
      this.setDevOverlayVisible((e.target as HTMLInputElement).checked);
    });
    this.syncOverlayVisibility();
  }

  public clearActiveTouchPointers(): void {
    if (this.movePointerId !== null) {
      this.movePointerId = null;
      this.joystickKnobEl.style.transform = 'translate(0px, 0px)';
      this.onTouchMoveRef(0, 0);
    }
    if (this.shootPointerId !== null) {
      const wasLifted = this.shootPointerLifted;
      this.shootPointerId = null;
      void wasLifted;
    }
  }

  public syncControlScheme(scheme: ControlScheme): void {
    this.root.querySelectorAll<HTMLButtonElement>('button[data-scheme]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scheme === scheme);
    });
    const sel = this.root.querySelector('#sel-controls') as HTMLSelectElement;
    if (sel) sel.value = scheme;
  }

  public syncResolutionScale(scale: number): void {
    const sel = this.root.querySelector('#sel-res-scale') as HTMLSelectElement;
    if (sel) sel.value = String(scale);
  }

  public setPartnerLogos(customList?: readonly PartnerLogoConfig[]): void {
    const ordered = getOrderedPartnerLogos(customList);
    const renderInto = (host: HTMLElement) => {
      host.innerHTML = '';
      for (const item of ordered) {
        const img = document.createElement('img');
        img.src = item.file;
        img.alt = item.accessibleName;
        img.title = item.accessibleName;
        if (item.optionalUrl) {
          const link = document.createElement('a');
          link.href = item.optionalUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', item.accessibleName);
          link.appendChild(img);
          host.appendChild(link);
        } else {
          host.appendChild(img);
        }
      }
    };
    renderInto(this.titlePartnersEl);
    renderInto(this.setupPartnersEl);
  }

  public setLoadingProgress(progress01: number, statusText: string): void {
    const pct = Math.max(0, Math.min(100, Math.round(progress01 * 100)));
    this.titleLoadingFillEl.style.width = `${pct}%`;
    this.titleLoadingTextEl.textContent = statusText;
    const bar = this.titleLoadingWrapEl.querySelector('.title-loading-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
  }

  public setLoadingComplete(): void {
    this.sceneLoaded = true;
    this.setLoadingProgress(1, 'Ready');
    this.titleLoadingWrapEl.classList.add('is-complete');
    this.titleScreenEl.classList.add('is-scene-ready');
    this.titlePlayBtnEl.disabled = false;
    this.titlePlayBtnEl.setAttribute('aria-disabled', 'false');
    const startBtn = this.root.querySelector('#btn-start-attempt') as HTMLButtonElement | null;
    if (startBtn) startBtn.disabled = false;
  }

  public setLoadingError(message: string): void {
    this.sceneLoaded = false;
    this.titleLoadingWrapEl.classList.add('hidden');
    this.titleErrorBoxEl.textContent = message;
    this.titleErrorBoxEl.classList.remove('hidden');
    this.titlePlayBtnEl.disabled = true;
    this.titlePlayBtnEl.setAttribute('aria-disabled', 'true');
  }

  public isTitleOpen(): boolean {
    return this.onTitleScreen;
  }

  public isHowToOpen(): boolean {
    return this.howtoOpen;
  }

  public isSetupOpen(): boolean {
    return !this.attractOverlayEl.classList.contains('hidden');
  }

  public isSettingsOpen(): boolean {
    return !this.settingsDrawerEl.classList.contains('hidden');
  }

  public closeTransientModals(): void {
    this.settingsDrawerEl.classList.add('hidden');
    this.compactMenuEl.classList.add('hidden');
    this.howtoOpen = false;
    this.howToModalEl.classList.add('hidden');
    if (this.lastPhase === 'Active' || this.onTitleScreen) {
      this.manualSetupOpen = false;
      this.syncOverlayVisibility();
    }
  }

  public setInputDevice(device: InputDeviceKind): void {
    if (this.currentInputDevice === device) return;
    this.currentInputDevice = device;
    this.root.dataset.inputDevice = device;
    this.hintsTextEl.textContent = INPUT_HINTS_TEXT[device];
  }

  public toggleDevOverlay(force?: boolean): void {
    const next = force ?? !this.devOverlayVisible;
    this.setDevOverlayVisible(next);
    const chk = this.root.querySelector('#chk-dev-overlay') as HTMLInputElement;
    if (chk) chk.checked = next;
  }

  private setDevOverlayVisible(visible: boolean): void {
    this.devOverlayVisible = visible;
    this.devOverlayEl.classList.toggle('hidden', !visible);
  }

  private syncHintsVisibility(): void {
    const show =
      !this.onTitleScreen &&
      !this.howtoOpen &&
      this.lastPhase === 'Active' &&
      !this.manualSetupOpen &&
      (this.keepHintsVisible || this.userToggledHints || this.hintsAutoHideTimeout !== null);
    this.hintsBarEl.classList.toggle('hidden', !show);
  }

  private syncOverlayVisibility(): void {
    const showSetup = (this.onTitleScreen ? this.manualSetupOpen : (this.lastPhase === 'Ready' || this.manualSetupOpen));
    this.titleScreenEl.classList.toggle('hidden', !this.onTitleScreen || showSetup || this.howtoOpen);
    this.root.classList.toggle('is-title-screen', this.onTitleScreen);
    this.attractOverlayEl.classList.toggle('hidden', !showSetup);
    this.root.classList.toggle('is-active-play', !this.onTitleScreen && this.lastPhase === 'Active' && !showSetup);
    this.syncHintsVisibility();
  }

  public syncModeSelection(mode: GameMode): void {
    this.currentMode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const sel = this.root.querySelector('#sel-mode') as HTMLSelectElement;
    if (sel) sel.value = mode;
    this.updateSetupLockState();
  }

  public syncVariantSelection(variant: AttackerVariant): void {
    this.root.querySelectorAll<HTMLButtonElement>('button[data-variant]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.variant === variant);
    });
    const sel = this.root.querySelector('#sel-variant') as HTMLSelectElement;
    if (sel) sel.value = variant;
  }

  public syncPracticeSpotSelection(spot: PracticeSpot): void {
    this.root.querySelectorAll<HTMLButtonElement>('button[data-spot]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.spot === spot);
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
    if (!text.trim()) return;
    this.captionEl.textContent = text.replace(/^\[|\]$/g, '');
    this.captionEl.classList.remove('hidden');
    if (this.captionTimeout !== null) {
      window.clearTimeout(this.captionTimeout);
    }
    this.captionTimeout = window.setTimeout(() => {
      this.captionEl.classList.add('hidden');
    }, 1800);
  }

  public showToast(text: string, variant: 'goal' | 'save' | 'wide' | 'info' = 'info'): void {
    this.toastEl.textContent = text;
    this.toastEl.dataset.variant = variant;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, 1500);
  }

  private updateSetupLockState(): void {
    const lockedByActiveAttempt = this.lastPhase === 'Active';
    const isShootout = this.currentMode === 'shootout_8s';

    this.setupLockNoteEl.classList.toggle('hidden', !lockedByActiveAttempt);
    this.setupActionsReadyEl.classList.toggle('hidden', lockedByActiveAttempt);
    this.setupActionsActiveEl.classList.toggle('hidden', !lockedByActiveAttempt);

    this.root.querySelectorAll<HTMLButtonElement>('#attract-overlay button[data-mode], #attract-overlay button[data-variant], #attract-overlay button[data-scheme]').forEach((btn) => {
      btn.disabled = lockedByActiveAttempt;
    });

    this.root.querySelectorAll<HTMLButtonElement>('#setup-spot-group button[data-spot], #btn-call-ball').forEach((btn) => {
      btn.disabled = lockedByActiveAttempt || isShootout;
    });

    this.setupSpotHintEl.classList.toggle('hidden', !isShootout);
    this.setupSpotGroupEl.classList.toggle('is-locked', isShootout);

    for (const id of ['#sel-mode', '#sel-variant', '#sel-diff', '#sel-controls']) {
      const sel = this.root.querySelector(id) as HTMLSelectElement | null;
      if (sel) sel.disabled = lockedByActiveAttempt;
    }
  }

  public updateState(opts: {
    isOnTitleScreen: boolean;
    gameMode: GameMode;
    freePlayStats: FreePlayStats;
    phase: AttemptPhase;
    remainingSeconds: number;
    hasValidCircleTouch: boolean;
    charge01: number;
    isLiftedMode: boolean;
    isReplaying: boolean;
    lastResult: AttemptResult | null;
  }): void {
    const prevPhase = this.lastPhase;
    this.lastPhase = opts.phase;
    this.currentMode = opts.gameMode;
    this.onTitleScreen = opts.isOnTitleScreen;

    if (!opts.isOnTitleScreen && prevPhase !== 'Active' && opts.phase === 'Active') {
      this.manualSetupOpen = false;
      if (!this.firstPlayHintsShown) {
        this.firstPlayHintsShown = true;
        if (this.hintsAutoHideTimeout !== null) {
          window.clearTimeout(this.hintsAutoHideTimeout);
        }
        this.hintsAutoHideTimeout = window.setTimeout(() => {
          this.hintsAutoHideTimeout = null;
          this.syncHintsVisibility();
        }, 4500);
      }
    }

    // Scorebug updates
    this.goalsValEl.textContent = String(opts.freePlayStats.goalsScored);
    this.savesValEl.textContent = String(opts.freePlayStats.keeperSaves);

    if (opts.gameMode === 'free_play') {
      this.modeTagEl.textContent = 'Free practice';
      this.timerBlockEl.classList.add('hidden');
      this.root.querySelector('.timer-divider')?.classList.add('hidden');
      this.circleStatusEl.classList.add('hidden');
    } else {
      this.modeTagEl.textContent = 'Shoot-out';
      this.timerBlockEl.classList.remove('hidden');
      this.root.querySelector('.timer-divider')?.classList.remove('hidden');
      this.circleStatusEl.classList.remove('hidden');
      this.timerEl.textContent = opts.remainingSeconds.toFixed(2);
      this.timerEl.classList.toggle('urgent', opts.phase === 'Active' && opts.remainingSeconds <= 2.2);

      if (opts.hasValidCircleTouch) {
        this.circleStatusEl.textContent = 'In circle';
        this.circleStatusEl.classList.add('legal');
      } else {
        this.circleStatusEl.textContent = 'Enter circle';
        this.circleStatusEl.classList.remove('legal');
      }
    }

    // Shot type & power meter
    this.powerFillEl.style.width = `${Math.round(opts.charge01 * 100)}%`;
    this.shotTypeEl.textContent = opts.isLiftedMode ? 'Lifted flick' : 'Ground hit';

    // Lock state & panel visibility
    this.updateSetupLockState();
    const showSetup =
      (opts.isOnTitleScreen ? this.manualSetupOpen : opts.phase === 'Ready' || this.manualSetupOpen) &&
      !opts.isReplaying;
    this.root.classList.toggle('is-title-screen', opts.isOnTitleScreen);
    this.titleScreenEl.classList.toggle('hidden', !opts.isOnTitleScreen || showSetup || this.howtoOpen);
    this.attractOverlayEl.classList.toggle('hidden', !showSetup);
    this.root.classList.toggle(
      'is-active-play',
      !opts.isOnTitleScreen && opts.phase === 'Active' && !showSetup && !opts.isReplaying,
    );
    this.replayControlsEl.classList.toggle('hidden', !opts.isReplaying);
    this.syncHintsVisibility();

    if (opts.gameMode === 'shootout_8s' && opts.phase === 'Result' && opts.lastResult && !opts.isReplaying && !this.manualSetupOpen) {
      this.bannerEl.classList.remove('hidden');
      this.bannerEl.dataset.outcome = opts.lastResult.outcome.toLowerCase();
      this.bannerTitleEl.textContent =
        opts.lastResult.outcome === 'Goal'
          ? 'Goal'
          : opts.lastResult.outcome === 'Time'
            ? 'Time expired'
            : opts.lastResult.outcome;
      this.bannerReasonEl.textContent = opts.lastResult.reason;
      this.bannerMetaEl.textContent = `Time: ${opts.lastResult.elapsedSeconds.toFixed(2)} s · Saves: ${opts.lastResult.savesCount} · Peak speed: ${(opts.lastResult.shotSpeedMps * 3.6).toFixed(0)} km/h`;
    } else {
      this.bannerEl.classList.add('hidden');
    }
  }
}
