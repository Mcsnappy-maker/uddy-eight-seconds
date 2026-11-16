---
name: babylon-blender-mcp-toolkit
description: Use when building 3D browser scenes in Babylon.js (WebGPU/WebGL2) or automating 3D asset creation with Blender MCP and Unreal MCP.
---

# Babylon.js & Blender/Unreal MCP Toolkit

Coordinate zero-budget browser-first 3D development with Babylon.js (WebGPU + WebGL2 fallback) and MCP automation bridges for Blender and future Unreal desktop builds.

## Babylon.js Capability Detection Pattern

Always probe `WebGPUEngine.IsSupportedAsync` before instantiating the engine and provide deterministic fallback + query override (`?renderer=webgl2` or `?renderer=webgpu`):

```ts
const wantsWebGL2 = new URLSearchParams(window.location.search).get("renderer") === "webgl2";
let engine: Engine | WebGPUEngine;
let activeBackend: "webgpu" | "webgl2" = "webgl2";

if (!wantsWebGL2 && await WebGPUEngine.IsSupportedAsync) {
  try {
    const webgpu = new WebGPUEngine(canvas, { antialias: true, powerPreference: "high-performance" });
    await webgpu.initAsync();
    engine = webgpu;
    activeBackend = "webgpu";
  } catch {
    engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  }
} else {
  engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
}
```

## Procedural PBR & Performance Guardrails

- Generate procedural diffuse, normal, and roughness maps into `DynamicTexture` / offscreen HTMLCanvas once at startup and cache materials across instances.
- Use `ShadowGenerator` with `usePercentageCloserFiltering = true` (or `usePoissonSampling` on Compatible tier) and freeze static pitch/fence world matrices (`mesh.freezeWorldMatrix()`).
- Ensure `WebGPUEngine` compatibility: avoid raw WebGL-only custom GLSL shaders without WGSL equivalents; prefer Babylon `PBRMaterial` and standard post-processing (`DefaultRenderingPipeline`).

## MCP Integration Architecture

- **Blender MCP (`blender-mcp`):** Configured in `~/.gemini/config/mcp_config.json` via `uvx blender-mcp`. When custom sculpted meshes (athletes, helmets, stadium architecture) are created in Blender, install the Blender add-on (`uvx blender-mcp install-addon`), launch Blender with the MCP server active on localhost, and export clean `glTF / GLB` files (`+Y` up, 1 m = 1 unit) into `public/assets/models/`.
- **Unreal MCP (Future Desktop Port):** Epic's built-in Unreal MCP plugin (UE 5.8+) exposes `http://127.0.0.1:8000/mcp` over Streamable HTTP when enabled in Editor Preferences (`Agentic Workflows > Model Context Protocol`). Do not install Unreal when targeting the browser-first phase.
