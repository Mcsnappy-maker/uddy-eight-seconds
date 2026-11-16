# Asset & Licence Register — Uddy: Eight Seconds

**Last Updated:** 2026-11-16  
**Budget Spent:** £0  
**Policy:** Every runtime package, external source base, 3D mesh, texture, audio effect, and deferred mode is logged below with provenance, licence, and honest classification.

---

## 1. Software & Runtime Packages

| Asset / Package | Creator / Maintainer | Source | Licence | Status |
|---|---|---|---|---|
| `@babylonjs/core` (`^8.x`) | Babylon.js Contributors / Microsoft | npm (`@babylonjs/core`) | Apache-2.0 | Active |
| `@babylonjs/loaders` (`^8.x`) | Babylon.js Contributors / Microsoft | npm (`@babylonjs/loaders`) | Apache-2.0 | Active |
| `@babylonjs/materials` (`^8.x`) | Babylon.js Contributors / Microsoft | npm (`@babylonjs/materials`) | Apache-2.0 | Active |
| Blender `5.3.0` | Blender Foundation | winget (`BlenderFoundation.Blender`) | GPL-3.0 (tool) | Active Offline Build Pipeline |
| `typescript`, `vite`, `vitest`, `playwright` | Microsoft / Vite / Vitest | npm | Apache-2.0 / MIT | Active Dev & Verification |
| `blender-mcp` (via `uvx`) | Siddharth Ahuja / OSS | PyPI (`blender-mcp`) | MIT | Configured Agent Bridge |

---

## 2. Character Source Base & Exported Skinned `.glb` Assets

| Asset | Source / Pipeline | Licence | Status |
|---|---|---|---|
| MakeHuman / MPFB2 Base Mesh, Targets, Rig & Skin Masks (`base.obj`, `macrodetails/*.target.gz`, `rig.game_engine.json`, `weights.game_engine.json`, `mpfb_*.jpg`) | `makehumancommunity/mpfb2` (`assets_src/makehuman_cc0/`) | **CC0 1.0 Universal (Public Domain)** | Verified Free Source Base |
| `uddy_attacker_a.glb` & `uddy_attacker_a.blend` | Generated via `scripts/build_hockey_characters_blender.py` in Blender 5.3 (`25,979` vertices, `53` bones): morphed CC0 adult male (`#9`), tailored jersey/shorts, hooped socks, turf shoes | CC0 Source + Original Project Code | **Replacement Skinned Character Active** (kit/crest tokens remain provisional pending club vector brand sheet) |
| `uddy_attacker_b.glb` & `uddy_attacker_b.blend` | Generated via `scripts/build_hockey_characters_blender.py` in Blender 5.3: morphed CC0 adult female (`#11`), contrasting skin/hair tone, tailored club kit | CC0 Source + Original Project Code | **Replacement Skinned Character Active** |
| `uddy_goalkeeper.glb` & `uddy_goalkeeper.blend` | Generated via `scripts/build_hockey_characters_blender.py` in Blender 5.3 (`36,947` vertices, `53` bones): CC0 human athlete underneath field-hockey helmet + steel cage, fitted smock (`#1`), contoured leg guards, foam kickers over turf soles, flat left deflector, stick glove | CC0 Source + Original Project Code | **Replacement Skinned Goalkeeper Active** (custom sculpted cloth/mocap clips remain future Phase 3 polish) |
| `uddy_stick.glb` | Generated via `scripts/build_hockey_characters_blender.py` in Blender 5.3: tapered NURBS carbon field-hockey stick with flat left face, curved J-hook & grip wrap | Original Project Code | **Active** |

---

## 3. Club Identity, Venue, Audio & Missing / Deferred Scope

| Asset / Feature | Implementation / Status | Licence / Notes |
|---|---|---|
| Club Name (**Uddingston Hockey Club**) | Official name verified [S1] | Verified |
| Colour Tokens (`#123A78`, `#F4C431`, `#091321`, `#F7F9FC`, `#A8B4C6`) | Provisional palette from Brief Section 10 | **Provisional** — replace from official club vector brand sheet |
| Official Club Vector Crest & Sponsors | Not supplied | **Missing** (clean text + geometric diamond used privately) |
| Synthetic Water-Based Turf & FIH Markings | Procedural normal/roughness turf + true-scale 3D ribbon lines | **Provisional Venue** — measured Uddingston Cricket & Sports Club photos/CAD missing |
| Two-Storey Sports Pavilion, Treeline & Spectators | Procedural club-inspired stadium backdrop | **Provisional Club-Inspired Surround** |
| Real-Time Web Audio Foley (whistle, stick strike, pad save, post, backboard, crowd) | Procedural Web Audio synthesis | **Active** (zero copyrighted samples) |
| **Penalty-Stroke Mode** | `validatePenaltyStrokeAction()` rules check only; full mode not yet built | **Explicitly Incomplete / Deferred** until shoot-out character milestone passes review |
