# Asset & Licence Register — Uddy: Eight Seconds

**Last Updated:** 2026-11-16  
**Budget Spent:** £0  
**Policy:** Every runtime package, 3D mesh, texture, audio effect, and font is logged below with provenance, licence, and honest classification (**Verified**, **Provisional**, or **Missing / Future Custom Asset**).

---

## 1. Software & Runtime Packages

| Asset / Package | Creator / Maintainer | Source | Licence | Status |
|---|---|---|---|---|
| `@babylonjs/core` (`^8.x`) | Babylon.js Contributors / Microsoft | npm (`@babylonjs/core`) | Apache-2.0 | Approved / Active |
| `@babylonjs/materials` (`^8.x`) | Babylon.js Contributors / Microsoft | npm (`@babylonjs/materials`) | Apache-2.0 | Approved / Active |
| `typescript` (`^5.8`) | Microsoft | npm (`typescript`) | Apache-2.0 | Approved / Dev |
| `vite` (`^6.3`) | Evan You & Vite Contributors | npm (`vite`) | MIT | Approved / Dev |
| `vitest` (`^3.1`) | Vitest Contributors | npm (`vitest`) | MIT | Approved / Test |
| `playwright` (`^1.52`) | Microsoft | npm (`playwright`) | Apache-2.0 | Approved / Benchmark & Proof |
| `blender-mcp` (via `uvx`) | Siddharth Ahuja / Open Source Contributors | PyPI (`blender-mcp`) | MIT | Approved / Agent Tooling |

---

## 2. Club Identity & Colour Tokens

| Asset | Value / Description | Creator / Source | Licence / Permission | Status |
|---|---|---|---|---|
| Club Name | **Uddingston Hockey Club** | Official club site [S1] | Factual identifier | **Verified** |
| Primary Palette | Deep Blue (`#123A78`), Gold (`#F4C431`), Night (`#091321`), Chalk (`#F7F9FC`), Slate (`#A8B4C6`) | Brief Section 10 proposal | **Provisional tokens** (not official hex codes; no Kelloch orange) | **Provisional** — replace from official brand vector artwork |
| Official Club Crest / Kit Sponsors | Vector crest, exact jersey stripes, hoop socks, sponsor logos | Uddingston Hockey Club | Not yet supplied | **Missing** (text-only identification & clean provisional blue/gold striped kit used privately) |

---

## 3. 3D Models, Textures & Materials (Current Slice)

| Asset | Implementation / Description | Creator | Licence | Status |
|---|---|---|---|---|
| Synthetic Water-Based Turf + Markings | Procedural 2048×2048 PBR diffuse/roughness/normal canvas textures with exact FIH white lines (`23m`, `14.63m` D-circle, `5m` dashed circle, `6.475m` spot, goal line) & wet floodlight sheen | Original Procedural (TypeScript) | Original Project Code (MIT/Proprietary to project) | **Provisional / Active** (upgradeable with measured club turf photo textures) |
| Regulation Goal Frame, Backboards & Dynamic Net | True-scale `3.66m × 2.14m × 1.20m` steel goalposts (`50×75mm`), `0.46m` dark blue/gold backboards, and dynamic vertex-deforming cord net mesh | Original Procedural (Babylon.js) | Original Project Code | **Active** |
| Field-Hockey Attacker Rig (2 Variants) | Hierarchical multi-part anatomical rig (`#9` & `#11`, two fictional adult variants of differing skin tone and build): head/eyes/hair, torso, shoulders/elbows/wrists, two-handed grip on flat-faced J-hook composite stick, shorts/skort option, hooped socks, shin guards, studded turf shoes | Original Procedural (Babylon.js) | Original Project Code | **Provisional Hero Rig** — custom Blender/MetaHuman sculpted meshes + motion-captured hockey clips identified as future visual upgrade |
| Field-Hockey Goalkeeper Rig + Full Outdoor Kit | Authentic field-hockey keeper (`#1`): caged helmet showing face, padded smock, rectangular chamfered foam leg guards with straps, strapped foam kickers over turf shoes, flat left-hand deflector blocker, right-hand padded stick glove, curved field-hockey stick (zero ice skates or ice catcher) | Original Procedural (Babylon.js) | Original Project Code | **Provisional Hero Rig** — coach/keeper reference review & Blender cloth/foam sculpting recommended for Phase 2+ |
| Match Ball | `0.0365m` radius dimpled Chalk-white ball with optional accessibility visibility halo (no collision enlargement) | Original Procedural | Original Project Code | **Active** |
| Club-Inspired Ground Surround | Weld-mesh perimeter fencing, ball-stop netting, team dugouts, elevated Uddy TV gantry, 6 floodlight towers, distant clubhouse silhouette, animated crowd spectators | Original Procedural | Original Project Code | **Provisional Club-Inspired** — measured Uddingston Cricket & Sports Club CAD/photos missing |

---

## 4. Audio Effects (Current Slice)

| Asset | Implementation | Creator | Licence | Status |
|---|---|---|---|---|
| Referee Whistle, Turf Footsteps, Stick Tap, Drive Strike, Lifted Flick, Foam Pad Save, Steel Post Clang, Backboard Boom, Crowd Roar/Gasp | Synthesized real-time in Web Audio API (zero external copyrighted audio samples) | Original Procedural (Web Audio) | Original Project Code | **Active** (can be supplemented with recorded field audio later) |

---

## 5. Explicitly Identified Missing / Future Custom Assets

1. **Official Uddingston Hockey Club vector crest & brand colour sheet** (club approval required before public branding).
2. **Authorised Uddingston Cricket & Sports Club photographic reference** (daylight turf, fencing, clubhouse, Uddy TV gantry).
3. **Custom sculpted Blender `.glb` athlete & goalkeeper meshes** (using `blender-mcp` when Blender is installed) + **real hockey coach/keeper motion-capture or keyframe animation clips** (stick drag, reverse hit, upright diving save).
4. **Recorded foley sound bank** (real stick-on-ball, water turf splash, Scottish crowd ambience).
