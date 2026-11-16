# Uddy: Eight Seconds — Uddingston Hockey Club

Browser-first 3D outdoor field-hockey shoot-out vertical slice built with **TypeScript**, **Vite**, and **Babylon.js 8** (WebGPU primary with tested WebGL2 fallback), created for **Mark O’Hare** / **Uddingston Hockey Club** under a **£0 software, asset, and hosting budget**.

> **Active Repository Location (Outside OneDrive):** `C:\Users\mohar\Projects\UddyHockey`  
> **Original Requested OneDrive Folder:** `C:\Users\mohar\OneDrive\Documents\CURRENT WORK\13 Projects and Workspaces\Projects\Hockey game` (holds mirrored docs, verification captures, benchmark reports, and launcher without `node_modules/` or build caches).

---

## Implemented Scope (First Encounter Slice)

- **True-Scale FIH Outdoor Geometry (`1 unit = 1 m`):** `3.66 m × 2.14 m × 1.20 m` goal, `0.46 m` backboard & sideboards, `14.63 m` circle + `3.66 m` straight section, `5 m` broken circle, `6.475 m` penalty spot, `22.90 m` 23 m line, `0.0365 m` radius match ball.
- **Deterministic 120 Hz Simulation & Adjudicator (`src/rules/`, `src/simulation/`):**
  - `8×` swept-sphere CCD substeps (`960 Hz` effective collision check) so `40 m/s` shots cannot tunnel past `50 mm` goalposts.
  - Strict `8.000 s` shoot-out deadline with zero post-buzzer grace period.
  - Inside-circle touch requirement (`FIH Rule 8.1`), whole-ball goal-line crossing, live rebounds on keeper saves & post hits, and out-of-bounds termination.
  - Monotonic `attemptId` so retry/reset immediately invalidates stale collisions and starts cleanly.
- **Playable 3D Encounter (`src/rendering/`, `src/entities/`):**
  - Articulated field-hockey attacker (2 switchable fictional adult variants `#9` & `#11`) with two-bone arm IK gripping a continuous tapered carbon J-hook stick, hooped club socks, and studded turf shoes.
  - Authentic outdoor field-hockey goalkeeper (`#1`) with caged helmet, flat beveled chest shield, contoured leg guards with knee rolls & straps, foam kickers over turf soles (no ice skates or ice catchers), flat left-hand deflector blocker, and right-hand stick glove.
  - Fair, physically bounded Goalkeeper AI (`First Go`, `Club Challenge`, `Cup Pressure` presets) reacting only to visible ball motion, approach angle, wind-up, and feints.
  - Real-time Web Audio sound synthesis (whistle, stick strike, lifted flick, foam pad save, steel post clang, backboard thump, turf footsteps, crowd reaction) with visual audio captions and Quiet Event mode.
  - Replay recorder, daylight/floodlit lighting presets, Showcase/Compatible quality tiers, accessibility controls (simplified 1-button mode, ball visibility ring, reduced motion, large text), and WebGPU / WebGL2 runtime switching.

---

## Running, Testing & Benchmarking

```bash
# 1. Run unit tests (14 FIH geometry, rules & CCD physics tests)
npm test

# 2. Verify geometry math & asset provenance scripts
npm run verify:rules
npm run verify:assets

# 3. Start local dev server (hot reload)
npm run dev

# 4. Build and preview production bundle
npm run build
npm run preview
# Open http://127.0.0.1:4173/ (or ?renderer=webgl2 to force WebGL2 fallback)

# 5. Re-run hardware benchmarks, 9 proof screenshots & uncut .webm capture
npm run benchmark
```

## Controls

- **Move:** `WASD` or Arrow Keys (or Gamepad Left Stick)
- **Aim:** Mouse cursor on goal plane (or Gamepad Right Stick)
- **Ground Drive Shot:** Hold & Release **Left Mouse Button** (or Right Trigger / `A`)
- **Lifted Flick / Scoop:** Hold & Release **Right Mouse Button** (or hold `F` / press `L` toggle)
- **V-Drag Feint:** `Space` (in Standard Controls)
- **Simplified Mode (1-Button + Lane):** Select in *Settings & Views*, steer lane with `A`/`D`, hold & release `Space` to shoot
- **Quick Reset / Retry:** `R`

---

## Hardware Benchmark Summary (Plugged-In Test Machine)

Measured on **Intel Core Ultra 7 256V · 15.66 GB RAM · Intel Arc 140V GPU (8 GB shared) · Windows 11 · AC Power** at **1920×1080 Showcase Preset**:

| Metric | WebGPU (`intel / xe-2lpg`) | WebGL2 Fallback (`ANGLE Intel Arc 140V D3D11`) |
|---|---|---|
| Average FPS | **60 fps** | **60 fps** |
| p50 / p95 / p99 Frame Time | 16.6 / 17.1 / 17.3 ms | 16.7 / 17.0 / 17.1 ms |
| Stalls > 50 ms | 0 | 0 |
| Cold Launch to Ready | 2478 ms | 2634 ms |
| Console / Page Errors | 0 | 0 |

See [benchmark-report.md](docs/verification/benchmark-report.md), [rules-register.md](docs/design/rules-register.md), and [asset-and-licence-register.md](docs/asset-register/asset-and-licence-register.md) for full details, provisional styling disclosures, and missing custom assets (club vector crest, measured ground photos, Blender sculpted meshes, Scottish Hockey umpire confirmation).
