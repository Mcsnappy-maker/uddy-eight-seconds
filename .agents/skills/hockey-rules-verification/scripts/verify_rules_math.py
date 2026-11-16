"""Deterministic math sanity verification for FIH outdoor field-hockey geometry."""
import math
import sys

GOAL_WIDTH = 3.66
GOAL_HALF_WIDTH = GOAL_WIDTH / 2.0  # 1.83
GOAL_HEIGHT = 2.14
GOAL_DEPTH_BOTTOM = 1.20
BACKBOARD_HEIGHT = 0.46
CIRCLE_RADIUS = 14.63
CIRCLE_STRAIGHT_HALF = 1.83
PENALTY_SPOT = 6.475
LINE_23M = 22.90
PITCH_LENGTH = 91.40
PITCH_WIDTH = 55.00
BALL_RADIUS = 0.0365
SHOOTOUT_DURATION = 8.0


def is_inside_shooting_circle(x: float, z: float, ball_radius: float = BALL_RADIUS) -> bool:
    """Return True when the point/ball overlaps or lies within the FIH D-circle."""
    if z < 0.0:
        return False
    ax = abs(x)
    if ax <= CIRCLE_STRAIGHT_HALF:
        return z <= CIRCLE_RADIUS + ball_radius
    dx = ax - CIRCLE_STRAIGHT_HALF
    return (dx * dx + z * z) <= (CIRCLE_RADIUS + ball_radius) ** 2


def is_whole_ball_goal(x: float, y: float, z: float, radius: float = BALL_RADIUS) -> bool:
    """Return True only when the entire ball sphere has crossed the goal line inside aperture."""
    return (
        z <= -radius
        and abs(x) <= (GOAL_HALF_WIDTH - radius)
        and y >= 0.0
        and y <= (GOAL_HEIGHT - radius)
    )


def main() -> int:
    checks = [
        ("Straight section boundary inside", is_inside_shooting_circle(0.0, 14.63) is True),
        ("Straight section corner at x=1.83", is_inside_shooting_circle(1.83, 14.63) is True),
        ("Arc point at 45 deg", is_inside_shooting_circle(1.83 + 14.63 * math.cos(math.pi / 4), 14.63 * math.sin(math.pi / 4)) is True),
        ("Outside circle beyond arc", is_inside_shooting_circle(12.0, 12.0) is False),
        ("Outside circle at 23m start", is_inside_shooting_circle(0.0, LINE_23M) is False),
        ("Partial ball crossing not goal", is_whole_ball_goal(0.0, 0.5, -0.02) is False),
        ("Whole ball crossing goal", is_whole_ball_goal(0.0, 0.5, -0.04) is True),
        ("Clipping post edge not goal", is_whole_ball_goal(1.81, 0.5, -0.04) is False),
        ("Clipping crossbar not goal", is_whole_ball_goal(0.0, 2.12, -0.04) is False),
    ]
    failed = [name for name, passed in checks if not passed]
    if failed:
        print("FAILED checks:", ", ".join(failed), file=sys.stderr)
        return 1
    print(f"All {len(checks)} FIH geometry checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
