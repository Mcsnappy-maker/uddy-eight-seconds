# ADR 0002: Agent Skillset, MCP Servers & Tooling Setup

**Date:** 2026-11-16  
**Status:** Active

---

## 1. Model Context Protocol (MCP) Servers Configured

Global configuration updated in `C:\Users\mohar\.gemini\config\mcp_config.json` (preserving the pre-existing `rea` server):

| Server ID | Transport | Command / Endpoint | Purpose |
|---|---|---|---|
| `blender-mcp` | Stdio | `C:\Users\mohar\AppData\Local\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uvx.exe blender-mcp` | Connects the AI agent to Blender for future custom 3D mesh sculpting, rigging, kit UV tailoring, and `.glb` export (when Blender is installed). Pre-cached and verified via `uvx`. |
| `rea` | Stdio | Pre-existing `rea-agents` | Preserved intact. |
| `unreal-mcp` *(Documented for Future Desktop Port)* | Streamable HTTP | `http://127.0.0.1:8000/mcp` (UE 5.8+ experimental built-in plugin) | Not active during the browser-first phase (Unreal is intentionally excluded on this 16 GB laptop). Documented in `babylon-blender-mcp-toolkit` skill. |

---

## 2. Project & Global Agent Skills Added

Installed globally in `C:\Users\mohar\.gemini\config\skills\` and mirrored in repository `.agents\skills\`:

1. **`hockey-rules-verification`** (`+ scripts/verify_rules_math.py`)  
   Enforces FIH 2026/2027 geometry, 8.000s deadline without grace period, whole-ball crossing, circle-entry touch validity, live rebounds, and penalty-stroke vs shoot-out isolation.
2. **`uddingston-asset-production`** (`+ scripts/validate_asset_manifest.py`)  
   Enforces Uddingston Hockey Club naming, provisional Deep Blue/Gold/Night/Chalk/Slate colour tokens, strict outdoor field-hockey equipment (turf footwear, strapped kickers, rectangular leg guards, left-hand flat blocker, J-head stick with flat left playing face), and license registration.
3. **`playable-quality-review`**  
   Enforces the 8-shot visual proof sequence, uncut `.webm` gameplay video capture, WebGPU + WebGL2 dual-backend verification, and honest frame-time percentile reporting (`p50`/`p95`/`p99`).
4. **`babylon-blender-mcp-toolkit`**  
   Provides tested Babylon.js `WebGPUEngine` + `Engine` (WebGL2) fallback detection patterns, procedural PBR pipelines, shadow/matrix optimization rules, and `blender-mcp` / `unreal-mcp` integration guidance.
