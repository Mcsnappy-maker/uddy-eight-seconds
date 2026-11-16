import {
  ACTIVE_RULES_PROFILE,
  FIH,
  Vec3,
  checkWholeBallGoalCrossing,
  isBallOutOfBounds,
  isInsideShootingCircle,
} from './RulesConfig';

export type AttemptPhase =
  | 'Preparing'
  | 'Ready'
  | 'Active'
  | 'Resolving'
  | 'Result';

export type AttemptOutcomeCode =
  | 'Goal'
  | 'Saved'
  | 'Wide'
  | 'Time'
  | 'Retake'
  | 'Foul';

export interface AttemptResult {
  attemptId: number;
  outcome: AttemptOutcomeCode;
  isGoal: boolean;
  reason: string;
  elapsedSeconds: number;
  savesCount: number;
  postHitsCount: number;
  shotSpeedMps: number;
  rulesProfileId: string;
}

export interface AdjudicatorEvent {
  type:
    | 'whistle_start'
    | 'circle_entered'
    | 'attacker_touch'
    | 'keeper_save'
    | 'post_hit'
    | 'backboard_hit'
    | 'attempt_ended';
  attemptId: number;
  timeSeconds: number;
  detail: string;
}

export class ShootoutAdjudicator {
  private attemptId = 0;
  private phase: AttemptPhase = 'Preparing';
  private elapsedSeconds = 0;
  private touchedInsideCircle = false;
  private ballOutsideCircleAfterTouch = false;
  private savesCount = 0;
  private postHitsCount = 0;
  private peakBallSpeedMps = 0;
  private lastResult: AttemptResult | null = null;
  private eventLog: AdjudicatorEvent[] = [];

  public getAttemptId(): number {
    return this.attemptId;
  }

  public getPhase(): AttemptPhase {
    return this.phase;
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  public getRemainingSeconds(): number {
    return Math.max(0, FIH.SHOOTOUT_DURATION - this.elapsedSeconds);
  }

  public hasValidCircleTouch(): boolean {
    return this.touchedInsideCircle && !this.ballOutsideCircleAfterTouch;
  }

  public getLastResult(): AttemptResult | null {
    return this.lastResult;
  }

  public getEventLog(): readonly AdjudicatorEvent[] {
    return this.eventLog;
  }

  public getSavesCount(): number {
    return this.savesCount;
  }

  public prepareNewAttempt(): number {
    this.attemptId += 1;
    this.phase = 'Ready';
    this.elapsedSeconds = 0;
    this.touchedInsideCircle = false;
    this.ballOutsideCircleAfterTouch = false;
    this.savesCount = 0;
    this.postHitsCount = 0;
    this.peakBallSpeedMps = 0;
    this.lastResult = null;
    this.eventLog = [];
    return this.attemptId;
  }

  public startWhistle(attemptId: number): boolean {
    if (attemptId !== this.attemptId || this.phase !== 'Ready') {
      return false;
    }
    this.phase = 'Active';
    this.logEvent('whistle_start', 'Umpire whistle — 8.00 s clock running');
    return true;
  }

  public notifyAttackerTouch(
    attemptId: number,
    ballPos: Vec3,
    isBackOfStick: boolean = false,
  ): void {
    if (attemptId !== this.attemptId || this.phase !== 'Active') {
      return;
    }
    if (isBackOfStick) {
      this.concludeAttempt(
        'Foul',
        false,
        'Back-of-stick offence by attacker (FIH Rule 9.5).',
      );
      return;
    }
    if (isInsideShootingCircle(ballPos.x, ballPos.z)) {
      if (!this.touchedInsideCircle) {
        this.logEvent('circle_entered', 'Attacker legally played ball inside shooting circle');
      }
      this.touchedInsideCircle = true;
      this.ballOutsideCircleAfterTouch = false;
    }
    this.logEvent('attacker_touch', 'Attacker played ball');
  }

  public notifyKeeperSave(attemptId: number): void {
    if (attemptId !== this.attemptId || this.phase !== 'Active') {
      return;
    }
    this.savesCount += 1;
    this.logEvent('keeper_save', `Goalkeeper save #${this.savesCount} — rebound remains live`);
  }

  public notifyPostHit(attemptId: number): void {
    if (attemptId !== this.attemptId || this.phase !== 'Active') {
      return;
    }
    this.postHitsCount += 1;
    this.logEvent('post_hit', 'Ball struck frame/post — rebound remains live');
  }

  public notifyBackboardHit(attemptId: number): void {
    if (attemptId !== this.attemptId || (this.phase !== 'Active' && this.phase !== 'Resolving')) {
      return;
    }
    this.logEvent('backboard_hit', 'Ball struck goal backboard');
  }

  public notifyKeeperOffence(attemptId: number, intentional: boolean): void {
    if (attemptId !== this.attemptId || this.phase !== 'Active') {
      return;
    }
    if (intentional) {
      this.concludeAttempt(
        'Foul',
        false,
        'Intentional goalkeeper offence — penalty stroke awarded (FIH Appendix 12).',
      );
    } else {
      this.concludeAttempt(
        'Retake',
        false,
        'Unintentional goalkeeper offence — shoot-out retake ordered.',
      );
    }
  }

  /**
   * Advances simulation rules by exactly one fixed dt (1/120s).
   * Enforces the strict 8.000 s shoot-out boundary and evaluates whole-ball goal crossing.
   */
  public step(
    attemptId: number,
    dt: number,
    prevBallPos: Vec3,
    currBallPos: Vec3,
    ballSpeedMps: number,
  ): AttemptResult | null {
    if (attemptId !== this.attemptId || this.phase !== 'Active') {
      return null;
    }

    this.elapsedSeconds += dt;
    if (ballSpeedMps > this.peakBallSpeedMps) {
      this.peakBallSpeedMps = ballSpeedMps;
    }

    // Strict FIH timing: zero grace period after 8.000 s (1e-6 tolerance prevents 960 * (1/120) IEEE-754 drift)
    if (this.elapsedSeconds > FIH.SHOOTOUT_DURATION + 1e-6) {
      this.elapsedSeconds = FIH.SHOOTOUT_DURATION;
      return this.concludeAttempt(
        'Time',
        false,
        'Time expired (8.00 s) before the whole ball crossed the goal-line.',
      );
    }

    // Whole-ball goal crossing check (evaluated BEFORE pitch circle-exit check so z < 0 inside goal is valid)
    if (checkWholeBallGoalCrossing(prevBallPos, currBallPos, FIH.BALL_RADIUS)) {
      if (this.hasValidCircleTouch()) {
        return this.concludeAttempt(
          'Goal',
          true,
          `Legal goal scored in ${this.elapsedSeconds.toFixed(2)} s from inside the circle.`,
        );
      }
      return this.concludeAttempt(
        'Foul',
        false,
        'Invalid goal — ball was not legally played inside the shooting circle before entering goal (FIH Rule 8.1).',
      );
    }

    // Track if ball exited circle back out onto the pitch after a prior circle touch
    if (
      this.touchedInsideCircle &&
      currBallPos.z >= 0 &&
      !isInsideShootingCircle(currBallPos.x, currBallPos.z)
    ) {
      this.ballOutsideCircleAfterTouch = true;
    }

    // Out-of-bounds back-line or sideline check
    if (isBallOutOfBounds(currBallPos, FIH.BALL_RADIUS)) {
      const outcome: AttemptOutcomeCode = this.savesCount > 0 ? 'Saved' : 'Wide';
      const detail =
        this.savesCount > 0
          ? 'Ball cleared wide/over back-line after goalkeeper save.'
          : 'Ball went over the back-line or sideline outside the goal.';
      return this.concludeAttempt(outcome, false, detail);
    }

    return null;
  }

  private concludeAttempt(
    outcome: AttemptOutcomeCode,
    isGoal: boolean,
    reason: string,
  ): AttemptResult {
    this.phase = 'Result';
    const result: AttemptResult = {
      attemptId: this.attemptId,
      outcome,
      isGoal,
      reason,
      elapsedSeconds: this.elapsedSeconds,
      savesCount: this.savesCount,
      postHitsCount: this.postHitsCount,
      shotSpeedMps: this.peakBallSpeedMps,
      rulesProfileId: ACTIVE_RULES_PROFILE.id,
    };
    this.lastResult = result;
    this.logEvent('attempt_ended', `${outcome}: ${reason}`);
    return result;
  }

  private logEvent(type: AdjudicatorEvent['type'], detail: string): void {
    this.eventLog.push({
      type,
      attemptId: this.attemptId,
      timeSeconds: this.elapsedSeconds,
      detail,
    });
  }
}
