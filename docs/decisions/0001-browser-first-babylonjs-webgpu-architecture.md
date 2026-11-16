# ADR 0001: Browser-First TypeScript, Vite & Babylon.js (WebGPU + WebGL2 Fallback)

**Date:** 2026-11-16  
**Status:** Accepted (Active Prototype Architecture)  
**Target Repository:** `C:\Users\mohar\Projects\UddyHockey`  
**Original Requested Folder:** `C:\Users\mohar\OneDrive\Documents\CURRENT WORK\13 Projects and Workspaces\Projects\Hockey game` (preserved intact)

---

## 1. Environment & Hardware Inventory (Verified on Local Machine)

| Component | Measured / Observed Value |
|---|---|
| Operating System | Windows 11 |
| Processor | Intel(R) Core(TM) Ultra 7 256V |
| System Memory | 15.66 GB RAM (unified/shared with iGPU) |
| Graphics Adapter | Intel(R) Arc(TM) 140V GPU (8 GB shared, Driver `32.0.101.8626`) |
| Free Disk (`C:`) | ~303.6 GiB (`326,018,015,232` bytes) |
| Installed Runtimes | `git`, `git-lfs`, `node` (`npm`/`npx`), `python 3.15.2`, `uv`/`uvx` |
| Installed Browsers | Google Chrome, Microsoft Edge |
| Absent Heavy Tools | Unreal Engine, Visual Studio C++ build tools, Blender (not installed in this phase) |

### OneDrive Path Risk Mitigation

The original folder `C:\Users\mohar\OneDrive\Documents\CURRENT WORK\13 Projects and Workspaces\Projects\Hockey game` resides inside OneDrive sync. Writing `node_modules/`, Vite caches (`.vite/`), or large build artifacts inside OneDrive slows builds, causes file locking conflicts, and consumes cloud sync quota.

- **Decision:** Keep the active Git checkout, `node_modules/`, `dist/`, and test captures outside OneDrive at `C:\Users\mohar\Projects\UddyHockey`.
- **Preservation:** The original OneDrive folder is left untouched during development, and global OneDrive settings were not altered. Summary documentation, registers, benchmark reports, and a launch guide are mirrored into the OneDrive folder once verified.

---

## 2. Engine Decision & Trade-Offs

The original master brief recommended Unreal Engine 5 on a desktop PC (32 GB RAM, RTX 4070 / RX 7800 XT class GPU) with a browser build deferred. Because this project is being built and tested directly on an Intel Core Ultra 7 256V / 16 GB / Intel Arc 140V laptop under strict constraints:

- **£0 additional software, asset, and subscription budget**
- **Free for everyone to play**
- **No paid cloud rendering (e.g., Pixel Streaming) or mandatory backend**
- **No Unreal or Visual Studio C++ installation in this phase**

We adopt a **browser-first architecture** using **TypeScript + Vite + Babylon.js 8**:

1. **Primary Renderer — WebGPU (`WebGPUEngine`):** Detected dynamically at runtime via `WebGPUEngine.IsSupportedAsync`. Provides modern compute/render pipeline efficiency on Windows D3D12 / Intel Arc 140V drivers.
2. **Tested Fallback — WebGL2 (`Engine`):** Automatically selected when WebGPU is absent, blocked, or fails initialization, and explicitly testable via `?renderer=webgl2` or in-UI toggle.
3. **Zero-Install Distribution:** Anyone at Uddingston Hockey Club can open the app in Chrome or Edge without downloading multi-gigabyte executables or needing developer tools.

### Trade-Offs Compared to Unreal Engine Desktop & Pixel Streaming

| Criterion | TypeScript + Babylon.js (Chosen) | Unreal Engine Desktop | Unreal Pixel Streaming |
|---|---|---|---|
| **Hardware fit on Intel Arc 140V / 16 GB** | Runs smoothly at 1080p with tuned PBR & PCF shadows | Heavy editor footprint (~40–100 GB disk), sluggish compile times on 16 GB | Requires dedicated cloud GPU host |
| **Budget** | £0 (MIT/Apache-2.0 OSS stack) | £0 software, high disk/time cost; C++ toolchain needed | Recurring GPU server bills |
| **Club Accessibility** | Instant browser launch, works offline once bundled/hosted statically | Requires Windows installer + capable club PC | Needs fast low-latency internet + backend |
| **Visual Fidelity Ceiling** | High-craft PBR, procedural textures, articulated hierarchical rigs, custom Blender glTF upgrades | Lumen GI, Nanite, MetaHuman native cinema polish | High fidelity, compressed video stream |
| **Future Upgrade Path** | Replace procedural meshes progressively with Blender `.glb` sculptures via `blender-mcp` | Separate codebase if a future desktop flagship is commissioned | Out of scope for free-to-play club release |

---

## 3. Quality & Honesty Contract

Choosing Babylon.js does not dilute the "Designed in 2038" visual craft standard or hockey accuracy:
- True-scale FIH pitch, shooting circle, backboard, goal posts, and ball geometry (`1 unit = 1 metre`).
- Deterministic 120 Hz simulation with 8x swept-sphere CCD substeps (`960 Hz` effective) decoupled from rendering FPS.
- Articulated outdoor field-hockey attacker and goalkeeper (no ice-hockey skates, pucks, or ice catcher gloves).
- Explicit labelling of all provisional textures/kits and missing custom sculpted/mocap assets until Blender / club reference passes replace them.
