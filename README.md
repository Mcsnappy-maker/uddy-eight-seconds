# Uddy: Eight Seconds — Uddingston Hockey Club

Browser-first 3D outdoor field-hockey shoot-out vertical slice built with **TypeScript**, **Vite**, **Babylon.js 8** (WebGPU primary with tested WebGL2 fallback), and **CC0 MakeHuman + Blender 5.3** 53-bone skinned character assets under a **£0 software, asset, and hosting budget**.

> **Active Repository Location (Outside OneDrive):** `C:\Users\mohar\Projects\UddyHockey`  
> **Preserved OneDrive Folder:** `C:\Users\mohar\OneDrive\Documents\CURRENT WORK\13 Projects and Workspaces\Projects\Hockey game` (contains mirrored docs, audit/rules/asset registers, benchmark reports, visual proofs, and `LAUNCH_GAME.bat` — no `node_modules/` or build caches).

---

## Implemented Scope & Skinned Character Pipeline

- **53-Bone Skinned CC0 Human Athletes (`scripts/build_hockey_characters_blender.py` -> `public/assets/models/`):**
  - Built headlessly in **Blender 5.3** from **CC0 1.0 Public Domain MakeHuman (`mpfb2`)** base topology, macrodetail muscle/athletic morphs, facial masks, and `game_engine` skeleton/weights.
  - **`uddy_attacker_a.glb` (`#9`) & `uddy_attacker_b.glb` (`#11`):** Two adult athlete variants with sculpted faces, eyes, hair, tailored bisected Uddingston jerseys & shorts, knee-high hooped socks, rounded turf shoes with molded soles, and model-space two-bone arm IK holding `uddy_stick.glb` in a separated two-handed crouch.
  - **`uddy_goalkeeper.glb` (`#1`):** Human athlete wearing a sculpted field-hockey helmet + steel wire cage (face visible inside), fitted padded smock, contoured leg guards, foam toe kickers over turf soles (no ice skates or ice catchers), flat left-hand deflector blocker, and right-hand padded stick mit.
- **Deterministic 120 Hz Rules & Physics (`src/rules/`, `src/simulation/`):**
  - Exact FIH geometry (`3.66 m × 2.14 m` goal, `14.63 m` D-circle + `3.66 m` straight, `22.90 m` 23 m line, `0.0365 m` ball radius), `8×` swept-sphere CCD substeps (`960 Hz`), strict `8.000 s` deadline, inside-circle touch check, whole-ball crossing, live rebounds, and framerate-independent determinism.
  - **Explicitly Deferred / Incomplete:** Penalty-stroke mode (`validatePenaltyStrokeAction` helper only), Five-Go / Team series menus, and multi-player networking remain deferred until this single encounter passes visual review.

---

## Running, Testing & Benchmarking

```bash
# 1. Regenerate .blend + .glb character models in Blender 5.3
"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --python scripts/build_hockey_characters_blender.py

# 2. Run all 20 automated tests (rules, CCD grazing collisions, determinism, AI fairness)
npm test

# 3. Verify geometry math, asset register & TypeScript types
npm run verify:rules
npm run verify:assets
npm run typecheck

# 4. Build & serve locally (relative './' base for £0 static hosting)
npm run build
npm run preview
# Open http://127.0.0.1:4173/ (or ?renderer=webgl2 for WebGL2 fallback)

# 5. Re-run hardware benchmarks, 11 proof screenshots & 7-scenario uncut .webm capture
npm run benchmark
```

---

## Hardware Benchmark Summary (Plugged-In Test Laptop)

Measured on **Intel Core Ultra 7 256V · 15.66 GB RAM · Intel Arc 140V GPU (8 GB shared) · Windows 11 · AC Power** at **1920×1080 Showcase Preset** (`2000 ms` warm-up + `5500 ms` active gameplay, HeadlessChrome 157):

| Metric | WebGPU (`intel / xe-2lpg`) | WebGL2 Fallback (`ANGLE Intel Arc 140V D3D11`) |
|---|---|---|
| Presented FPS (60 Hz Display Vsync-Capped) | **59.81 fps** | **59.99 fps** |
| Presented Frame Interval (p50 / p95 / p99) | 16.7 / 17.3 / 24.8 ms | 16.7 / 17.1 / 17.3 ms |
| **Active Render Work (`SceneInstrumentation`)** | **6.70 ms avg / 6.41 ms p50 / 9.39 ms p95** | **4.27 ms avg / 4.12 ms p50 / 4.65 ms p95** |
| Stalls > 50 ms / Console Errors | **0 / 0** | **0 / 0** |
| JS Heap Used | 90.11 MB | 98.29 MB |

See [benchmark-report.md](docs/verification/benchmark-report.md), [character-and-asset-audit.md](docs/asset-register/character-and-asset-audit.md), [0003-zero-cost-static-deployment-plan.md](docs/decisions/0003-zero-cost-static-deployment-plan.md), [rules-register.md](docs/design/rules-register.md), and [asset-and-licence-register.md](docs/asset-register/asset-and-licence-register.md).
