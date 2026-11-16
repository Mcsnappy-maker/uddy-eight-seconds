export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RulesEditionId = 'FIH-OUTDOOR-2027-DRAFT-SCOT-PENDING';

export type DifficultyPreset = 'first_go' | 'club_challenge' | 'cup_pressure';

export type ControlScheme = 'standard' | 'simplified';

export interface RulesProfileMetadata {
  readonly id: RulesEditionId;
  readonly fihEdition: string;
  readonly tournamentRegulation: string;
  readonly scottishHockeyStatus: string;
  readonly checkedDate: string;
  readonly shootoutDurationSeconds: number;
  readonly allowGracePeriodAfterTimer: boolean;
}

export const ACTIVE_RULES_PROFILE: RulesProfileMetadata = {
  id: 'FIH-OUTDOOR-2027-DRAFT-SCOT-PENDING',
  fihEdition: 'FIH Rules of Hockey (2026 & 2027 Outdoor, international effect 1 Nov 2026)',
  tournamentRegulation: 'FIH Outdoor Tournament Regulations Nov 2026, Appendix 12 (Shoot-Out)',
  scottishHockeyStatus: 'Provisional — awaiting qualified Scottish Hockey umpire confirmation',
  checkedDate: '2026-11-16',
  shootoutDurationSeconds: 8.0,
  allowGracePeriodAfterTimer: false,
};

/**
 * Authoritative FIH outdoor pitch, goal, circle, and ball measurements in metres.
 * Coordinate convention:
 * - Origin (0, 0, 0) is at pitch level at the center of the inner scoring edge of the goal line.
 * - +Y is up.
 * - +Z points out onto the pitch toward the 23 m line and halfway line.
 * - -Z points inside the goal toward the backboard.
 * - -X is attacker's right (keeper's left); +X is attacker's left (keeper's right).
 */
export const FIH = {
  PITCH_LENGTH: 91.4,
  PITCH_HALF_LENGTH: 45.7,
  PITCH_WIDTH: 55.0,
  PITCH_HALF_WIDTH: 27.5,
  LINE_WIDTH: 0.075,

  GOAL_WIDTH: 3.66,
  GOAL_HALF_WIDTH: 1.83,
  GOAL_HEIGHT: 2.14,
  GOAL_POST_WIDTH: 0.05,
  GOAL_POST_DEPTH: 0.075,
  GOAL_DEPTH_BOTTOM: 1.2,
  GOAL_DEPTH_TOP: 0.9,
  BACKBOARD_HEIGHT: 0.46,

  CIRCLE_RADIUS: 14.63,
  CIRCLE_STRAIGHT_HALF: 1.83,
  CIRCLE_FIVE_METER_OFFSET: 5.0,
  PENALTY_SPOT_DISTANCE: 6.475,
  PENALTY_SPOT_RADIUS: 0.075,
  LINE_23M_DISTANCE: 22.9,

  BALL_RADIUS: 0.0365,
  BALL_MASS_KG: 0.16,
  GRAVITY: 9.81,

  SHOOTOUT_DURATION: 8.0,
  SIM_FIXED_HZ: 120,
  SIM_FIXED_DT: 1 / 120,
  PHYSICS_SUBSTEPS: 8,
} as const;

export const UDDINGSTON_COLOURS = {
  DEEP_BLUE: '#123A78', // Provisional club token — replace from approved vector artwork
  GOLD: '#F4C431',      // Provisional club token — replace from approved vector artwork
  NIGHT: '#091321',
  CHALK: '#F7F9FC',
  SLATE: '#A8B4C6',
  TURF_BLUE: '#155091',
  TURF_RUNOFF_GREEN: '#1E6146',
} as const;

/**
 * Exact FIH shooting-circle geometry check:
 * Central straight line of 3.66 m parallel to goal-line at z = 14.63 m,
 * flanked by two quarter-circle arcs of radius 14.63 m centered at (±1.83, 0).
 */
export function isInsideShootingCircle(
  x: number,
  z: number,
  ballRadius: number = FIH.BALL_RADIUS,
): boolean {
  if (z < 0) return false;
  const ax = Math.abs(x);
  const limit = FIH.CIRCLE_RADIUS + ballRadius;
  if (ax <= FIH.CIRCLE_STRAIGHT_HALF) {
    return z <= limit;
  }
  const dx = ax - FIH.CIRCLE_STRAIGHT_HALF;
  return dx * dx + z * z <= limit * limit;
}

/**
 * Returns true only when the ball transitions into or occupies a state where the
 * entire sphere has cleared the scoring edge of the goal-line (z <= -radius)
 * strictly between the inner post faces and beneath the underside of the crossbar.
 */
export function checkWholeBallGoalCrossing(
  prevPos: Vec3,
  currPos: Vec3,
  radius: number = FIH.BALL_RADIUS,
): boolean {
  const goalPlaneZ = -radius;
  const maxX = FIH.GOAL_HALF_WIDTH - radius;
  const maxY = FIH.GOAL_HEIGHT - radius;

  // Already behind plane: check only if moving across from valid front or within net volume
  if (prevPos.z > goalPlaneZ && currPos.z <= goalPlaneZ) {
    const dz = currPos.z - prevPos.z;
    const t = Math.abs(dz) > 1e-8 ? (goalPlaneZ - prevPos.z) / dz : 1.0;
    const clampedT = Math.max(0, Math.min(1, t));
    const crossX = prevPos.x + (currPos.x - prevPos.x) * clampedT;
    const crossY = prevPos.y + (currPos.y - prevPos.y) * clampedT;
    return Math.abs(crossX) <= maxX && crossY >= 0 && crossY <= maxY;
  }

  // Fallback for already-crossed single-frame state inside goal box (never from outside side-netting)
  if (
    currPos.z <= goalPlaneZ &&
    currPos.z >= -FIH.GOAL_DEPTH_BOTTOM + radius &&
    prevPos.z >= -FIH.GOAL_DEPTH_BOTTOM &&
    Math.abs(prevPos.x) <= maxX &&
    Math.abs(currPos.x) <= maxX &&
    currPos.y >= 0 &&
    currPos.y <= maxY
  ) {
    return true;
  }

  return false;
}

export function isBallOutOfBounds(pos: Vec3, radius: number = FIH.BALL_RADIUS): boolean {
  if (Math.abs(pos.x) > FIH.PITCH_HALF_WIDTH + radius) {
    return true;
  }
  if (pos.z > FIH.PITCH_HALF_LENGTH + radius) {
    return true;
  }
  // Over the back-line outside the goal aperture (posts outer face at ±1.88)
  if (pos.z < -radius && Math.abs(pos.x) > FIH.GOAL_HALF_WIDTH + FIH.GOAL_POST_WIDTH) {
    return true;
  }
  return false;
}

/**
 * Distinct Penalty-Stroke action rule validator (kept separate from Shoot-Out rules).
 * Enforces FIH 13.7–13.9: whistle first, push/flick/scoop only, no hit/drag/feint, single contact.
 */
export interface PenaltyStrokeAttemptState {
  whistleBlown: boolean;
  contactCount: number;
  actionType: 'push' | 'flick' | 'scoop' | 'hit' | 'drag' | 'feint';
  keeperFeetOnLineAtContact: boolean;
}

export function validatePenaltyStrokeAction(state: PenaltyStrokeAttemptState): {
  legal: boolean;
  reason?: string;
} {
  if (!state.whistleBlown) {
    return { legal: false, reason: 'Ball played before umpire whistle.' };
  }
  if (state.contactCount > 1) {
    return { legal: false, reason: 'Penalty stroke allows only a single contact; no follow-up allowed.' };
  }
  if (state.actionType === 'hit' || state.actionType === 'drag' || state.actionType === 'feint') {
    return { legal: false, reason: `Illegal stroke technique (${state.actionType}); only push, flick, or scoop permitted.` };
  }
  if (!state.keeperFeetOnLineAtContact) {
    return { legal: false, reason: 'Goalkeeper moved feet off goal-line before ball was played (retake/offence procedure).' };
  }
  return { legal: true };
}
