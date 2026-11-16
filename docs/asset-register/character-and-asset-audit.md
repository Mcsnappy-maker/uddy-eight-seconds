# Character & Asset Audit — Commit `25ece0f`

**Audit Date:** 2026-11-16  
**Baseline Commit Reviewed:** `25ece0f` (`feat: Uddy Eight Seconds Phase 0-2 WebGPU/WebGL2 shoot-out vertical slice`)  
**Decision:** Preserve simulation/rules/audio/replay code; **reject procedural geometric athletes, robotic keeper kit, peg spectators, and low-legibility HUD text**. Replace all characters with properly modelled, UV-textured, 53-bone vertex-skinned human `.glb` meshes derived from CC0 MakeHuman assets via a headless Blender pipeline.

---

## 1. Existing System & Asset Audit

| System / Asset | Current Implementation (`25ece0f`) | Classification | Action for Replacement Milestone |
|---|---|---|---|
| `src/rules/RulesConfig.ts`, `ShootoutAdjudicator.ts` | Deterministic FIH geometry, 8.000 s clock, whole-ball goal crossing, inside-circle touch rule | **Reusable Production Code** | Retain; extend automated tests with recorded-input framerate determinism & boundary matrix |
| `src/simulation/PhysicsWorld.ts` | Fixed 120 Hz step with 8× swept-sphere CCD substeps (`960 Hz`), post/backboard/net & OBB collisions | **Reusable Production Code** | Retain; expand grazing-angle and high-speed anti-tunnelling tests |
| `src/entities/AttackerController.ts`, `GoalkeeperAI.ts` | Input controller, dribble spring physics, fair bounded keeper state machine | **Reusable Production Code** | Retain; verify AI fairness (no hidden aim reading) via automated tests |
| `src/audio/SoundManager.ts`, `src/replay/ReplayRecorder.ts`, `src/rendering/EngineManager.ts` | Web Audio synthesis, transform replay buffer, WebGPU/WebGL2 detector | **Reusable Production Code** | Retain; wire `SceneInstrumentation` into `HockeyGameApp.ts` to separate GPU work from 60 Hz display vsync |
| `src/rendering/PBRMaterials.ts` (turf & markings) | Procedural turf fiber normal/roughness & 3D ribbon FIH markings | **Provisional Venue Asset** | Retain base pitch; note measured club turf photos remain a future club-reference upgrade |
| `src/rendering/AthleteModels.ts` (`AttackerVisualRig`, `KeeperVisualRig`) | Procedural `CreateCylinder` / `CreateSphere` / `CreateCapsule` / `CreateBox` segmented figures; visually unacceptable close-up | **Rejected Visual Prototype** | **Replace entirely** with 53-bone vertex-skinned CC0 human `.glb` characters (`uddy_attacker_a.glb`, `uddy_attacker_b.glb`, `uddy_goalkeeper.glb`) built in Blender |
| `src/rendering/VenueScene.ts` (Clubhouse & Spectators) | Flat rectangular pavilion box and uniform cylinder+sphere spectator pegs | **Temporary Prototype Surround** | Upgrade to two-storey sports pavilion with brick/stone base, upper viewing gallery, eaves, trees, and varied spectator poses |
| `src/style.css` (HUD Text Sizes) | Small 11–13 px labels difficult to read from playing distance | **Needs Accessibility Fix** | Scale HUD typography (`16–20 px` controls/badges, `50 px` timer) for clear playability |
| Penalty-Stroke Mode | Only single-action validator helper exists (`validatePenaltyStrokeAction`) | **Explicitly Incomplete / Deferred** | Keep explicitly marked incomplete until replacement characters & shoot-out slice pass visual review |

---

## 2. Candidate Free Character Base Evaluation (£0 Budget)

| Candidate Source | Licence | Anatomy & Topology | Rig & Modification Rights | Verdict |
|---|---|---|---|---|
| **MakeHuman / MPFB2 Core (`base.obj` + `macrodetails/*.target.gz` + `rig.game_engine.json` + `weights.game_engine.json`)** | **CC0 1.0 Universal (Public Domain)** | 13,380-vertex clean quad human mesh with sculpted face, nose, lips, eyelids, ears, fingers, toes, eye & hair helper topology | Full commercial & modification rights; 53-bone `game_engine` skeleton with painted smooth vertex weights; can tailor bespoke field-hockey kit, socks, turf shoes, and keeper armour directly around the morphed human body in Blender | **SELECTED** |
| Three.js / Mixamo `Soldier.glb` | CC0 / Example asset | Military combat uniform, tactical boots, backpack | Cannot legally pass as outdoor field-hockey kit without full stripping/re-modelling | **Rejected** |
| Three.js / Mixamo `Xbot.glb` | Mixamo sample | Featureless segmented robot mannequin | Explicitly violates human athlete requirement | **Rejected** |
| Three.js / Babylon `Michelle.glb`, `HVGirl.glb` | Sample assets | Casual streetwear / festival outfit | Wrong attire, single character aesthetic, unsuitable for field-hockey kit & keeper equipment | **Rejected** |

---

## 3. Target Replacement Deliverable Specification

1. **Replacement Skinned Attackers (`uddy_attacker_a.glb`, `uddy_attacker_b.glb`):**
   - Morphed athletic male & female adult variants built from CC0 MakeHuman `base.obj` + `macrodetails` targets (`caucasian-male-young` + `universal-male-young-maxmuscle-averageweight`, and `african-female-young` + `universal-female-young-maxmuscle-averageweight`), with full facial anatomy, natural hair, tailored Uddingston polo/jersey (`#9` & `#11`), athletic shorts, knee-high hooped socks over shin contours, and sculpted studded turf shoes — all vertex-skinned cleanly to the 53-bone `game_engine` armature.
   - True two-handed field-hockey stance: left hand grips the top handle butt (`0.04 m`), right hand grips lower on the shaft (`0.38 m` down) during dribbling/feinting/push prep, sliding cleanly during full drives, with fingers curled around the grip.
2. **Replacement Skinned Goalkeeper (`uddy_goalkeeper.glb`):**
   - Full CC0 human athlete underneath (`#1`) with visible face, eyes, and neck inside a sculpted field-hockey helmet + steel wire cage, wearing a fitted goalkeeper smock over chest protection, padded goalkeeper shorts, ergonomic contoured outdoor leg guards, strapped foam kickers over turf shoes, left-hand flat rectangular deflector pad, and right-hand padded stick glove holding a field-hockey stick.
