# Uddy: Eight Seconds — Rules & Simulation Register

**Profile ID:** `FIH-OUTDOOR-2027-DRAFT-SCOT-PENDING`  
**Last Checked:** 2026-11-16  
**Reviewer Status:** Automated geometry & simulation tests active; **qualified Scottish Hockey umpire review still required** before declaring official domestic compliance.

---

## 1. Classification Policy

- **Verified:** Supported by primary FIH / Scottish Hockey / club documents listed in Section 25 of the Master Brief.
- **Proposed:** Engineering and tuning defaults implemented for this playable vertical slice.
- **To Confirm:** Requires Scottish Hockey umpire interpretation or Uddingston Hockey Club input before official tournament claims.

---

## 2. Geometry & Simulation Constants (Verified FIH Outdoor Standards)

Source: FIH Rules of Hockey 2026 (Field & Equipment) [S8], FIH Rules of Hockey 2027 (effective 1 Nov 2026) [S9], FIH Outdoor Tournament Regulations Nov 2026 Appendix 12 [S10].

| Element | Dimension (m) | Status | Coordinate Reference (`Goal Center = (0, 0, 0)`) |
|---|---|---|---|
| Pitch length × width | `91.40 × 55.00` | Verified | Sidelines `x = ±27.50`; back-line `z = 0.0` (attacking half shown up to midfield / 23 m+ buffer) |
| Goal width × height | `3.66 × 2.14` | Verified | Inner posts at `x = ±1.83`; crossbar underside `y = 2.14` |
| Post & crossbar cross-section | `0.050 × 0.075` | Verified | Outer edge `x = ±1.88`, front face `z = 0.0` to `z = -0.075` |
| Goal depth (bottom / top) | `1.20 / 0.90` | Verified | Sideboards run `z = 0.0` to `z = -1.20` |
| Backboard & sideboard height | `0.46` | Verified | Interior boards `y = 0.0` to `y = 0.46` |
| Shooting circle | `14.63` radius + `3.66` straight | Verified | Straight line at `z = 14.63` (`|x| ≤ 1.83`); quarter arcs centered at `(±1.83, 0)` |
| 5 m broken circle | `19.63` outer offset | Verified | Concentric `5.00 m` outside shooting circle (`300 mm` dashes / `3.0 m` gaps) |
| Penalty spot | `6.475` from outer goal-line edge | Verified | `z = 6.475`, diameter `0.15 m` |
| 23 m line | `22.90` from back-line | Verified | Shoot-out ball starting spot `(0, 0.0365, 22.90)` |
| Hockey ball radius / diameter | `0.0365` (`~73 mm` diam.) | Verified | FIH circumference `224–235 mm`, mass `156–163 g` (`0.160 kg`) |

---

## 3. Shoot-Out Rules Contract (8-Second Slice)

| Rule / Obligation | Implementation Behaviour | Status |
|---|---|---|
| Starting setup | Ball on 23 m line `(0, 22.90)`; attacker behind ball outside 23 m (`z ≈ 23.85`); keeper on/behind goal-line (`z = -0.10`) between posts | Verified [S10] |
| Start signal & clock | Whistle sounds when attempt transitions `Ready → Active`; `8.000 s` countdown begins on same authoritative simulation timeline | Verified [S10] |
| Hard deadline | No automatic grace period after `8.000 s`: ball must wholly cross goal plane before `elapsed > 8.000` | Verified [S10] |
| Inside-circle legality | Goal is valid **only** if the attacker touched/played the ball inside the shooting circle (`isInsideShootingCircle`) and it did not exit the circle before crossing the goal plane | Verified [S9, 8.1] |
| Whole-ball crossing | Goal triggers only when entire ball sphere (`z <= -0.0365`) clears inner goal-line between posts (`|x| <= 1.83 - 0.0365`) and below crossbar (`y <= 2.14 - 0.0365`) | Verified [S9] |
| Live rebounds | Goalkeeper saves or post/crossbar rebounds keep the attempt `Active` while `elapsed <= 8.000` and ball stays in-bounds; attacker may shoot again | Verified [S10] |
| Out of bounds | Ball crossing back-line outside goal (`z < -0.0365` and `|x| > 1.83`) or sideline (`|x| > 27.50`) ends attempt as `Wide / Out` | Verified [S10] |
| Back-of-stick prevention | Input / stick swing geometry enforces legal flat left-face stick rotation; illegal back-stick / foul path tracked by adjudicator | Proposed / Verified [S9, 9.5] |
| Swept CCD | `120 Hz` physics step with `8×` substeps (`960 Hz` collision checks) prevents `40 m/s` shots tunnelling past `50 mm` goalposts | Proposed Engineering Spec |
| Keeper offences | Intentional vs unintentional keeper fouling during shoot-out (retake vs penalty stroke) | **To Confirm** (Scaffolded in adjudicator types; full foul-intent collision heuristic & penalty-stroke mode scheduled after visual/encounter gate) |
| Scottish Hockey domestic profile | Confirm whether current domestic Scottish competition applies FIH Nov 2026 / 2027 edition without local variation | **To Confirm** with Scottish Hockey umpire [S6, S7] |

---

## 4. Penalty-Stroke Mode Separation Note

Per Section 5 & Section 6 of the brief, **Penalty-Stroke Mode** has strict distinct constraints (spot at `6.475 m`, keeper both feet on line until ball played, push/flick/scoop only, no hit/drag/feint, single contact, no follow-up). In accordance with the instruction *"Do not build menus, accounts, online services or extra modes before demonstrating that this single encounter is enjoyable and visually convincing"*, this slice delivers the complete **8-Second Shoot-Out Encounter** first while keeping the `RulesProfile` and `AttemptAdjudicator` cleanly separated so Penalty Stroke attaches cleanly in the next phase.
