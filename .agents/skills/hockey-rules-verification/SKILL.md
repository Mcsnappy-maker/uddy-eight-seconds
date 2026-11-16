---
name: hockey-rules-verification
description: Use when implementing, testing, or reviewing field-hockey rules, pitch/circle/goal geometry, 8-second shoot-out timing, live rebounds, penalty-stroke restrictions, or adjudication logic.
---

# Hockey Rules Verification

Verify every simulation dimension, timer boundary, scoring rule, and shoot-out / penalty-stroke procedure against the **FIH Rules of Hockey (2026 & 2027 Outdoor editions)** and **FIH November 2026 Outdoor Tournament Regulations (Appendix 12)**.

## Core Principles

1. **One authoritative adjudicator:** Gameplay UI, animation, audio, and replay only reflect decisions made by the single rules adjudicator.
2. **Explicit rules profile versioning:** Record the FIH edition, tournament regulation version, checked date, and unconfirmed domestic Scottish Hockey variations. Never label unconfirmed domestic profiles as officially certified.
3. **Separate regulation vs assisted play:** Never silently relax the 8.000s deadline, circle-entry rule, or whole-ball goal-crossing threshold in regulation mode.
4. **Distinct shoot-out vs penalty-stroke state machines:** Do not merge them; penalty strokes forbid hits, dragging, feints, second contacts, and follow-ups, while shoot-outs last 8.000s and allow live rebounds.

## Authoritative Geometry Constants (Metres)

| Feature | Exact Measurement (m) | Coordinate Notes (Goal Mouth Center = `x=0, z=0`) |
|---|---|---|
| Pitch total | `91.40 × 55.00` | Sidelines at `x = ±27.50`; back-line at `z = 0` |
| Goal aperture | `3.66 × 2.14` | Inner posts at `x = ±1.83`; crossbar underside at `y = 2.14` |
| Goal post / bar cross-section | `0.050 × 0.075` | Rectangular section, painted white |
| Goal depth | `1.20` bottom / `0.90` top | Sideboards and backboard inside net frame |
| Backboard height | `0.46` | Vertical board at back & sides of goal (`z = -1.20` back) |
| Shooting circle | `14.63` radius + `3.66` straight | Straight line at `z = 14.63` (`|x| ≤ 1.83`); quarter arcs centered at `(±1.83, 0)` |
| 5 m broken circle | `19.63` outer radius | `5.00 m` outside shooting circle (`300 mm` dashes, `3 m` gaps) |
| Penalty spot | `6.475` | Measured from outer edge of goal-line (`150 mm` diameter) |
| 23 m line | `22.90` | Shoot-out ball starts at `(0, 22.90)` |
| Field-hockey ball | `0.0365` radius (`224–235 mm` circ.) | `156–163 g` mass |

## Whole-Ball Goal Crossing & Circle Legality

- **Whole-ball crossing:** A goal is scored only if the **entire sphere** crosses the inner plane of the goal-line (`z <= -BALL_RADIUS`) while bounded inside the aperture (`|x| <= 1.83 - BALL_RADIUS` and `0 <= y <= 2.14 - BALL_RADIUS`).
- **Inside-circle touch requirement:** The ball must be touched/played by an attacker inside the shooting circle (`isInsideShootingCircle(x, z)`) before wholly crossing the goal-line without leaving the circle again.
- **Zero post-8.000s grace period:** If the 8.000-second shoot-out clock expires (`elapsed > 8.000`) before the whole ball crosses the goal plane, the attempt ends as **Time Expired** — even if the shot was struck prior to 8.000s.

## Shoot-Out Attempt Resolution Rules

- **Live rebounds:** A save by the goalkeeper or rebound off the goalpost/crossbar does **not** end a shoot-out while `elapsed <= 8.000` and the ball remains in bounds on the pitch.
- **Out of bounds:** Crossing the back-line outside the goalposts (`z < 0` and `|x| > 1.83`) or crossing a sideline ends the attempt immediately.
- **Swept collision (CCD):** At 40 m/s stress-test velocity, a 120 Hz step moves ~0.333 m (> `0.05m` goalpost width). Always use swept sphere/substepping (`>= 8x` substeps per 120 Hz step) so fast shots cannot tunnel through posts or keeper equipment.
- **Monotonic attempt IDs:** Assign a fresh `attemptId` on every start/retry and discard stale physics/replay callbacks.

## Verification Script

Run the math/geometry verification helper whenever modifying constants or circle logic:

```bash
python scripts/verify_rules_math.py
```
