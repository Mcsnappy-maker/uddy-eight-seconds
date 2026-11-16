# Uddy: Eight Seconds — Hardware Benchmark & Visual Proof Report

**Date:** 2026-11-16T20:09:43.094Z  
**Test Machine:** Intel Core Ultra 7 256V · 15.66 GB RAM · Intel Arc 140V GPU (Windows 11, Plugged In)  
**Browser:** `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36`  
**Methodology:** 2000 ms warm-up + 5500 ms active gameplay (Active 120Hz dribble & keeper AI pursuit on 1920x1080 Showcase preset).  
**Skinned Character Geometry:** Attacker (23933 vertices, 53 bones), Goalkeeper (35021 vertices, 53 bones).

## 1. Renderer Benchmark Results

> **Note on 60 Hz Display Cap:** Chromium's `requestAnimationFrame` paces frame presentation to the laptop's 60 Hz display refresh (`~16.67 ms`), so minor compositor/vblank jitter puts wall-clock `p95` around `17.0 ms`. Actual per-frame engine render work measured via Babylon `SceneInstrumentation.frameTimeCounter` is listed separately under **Active Render Work** to demonstrate true GPU headroom.

| Metric | Primary (`?renderer=webgpu`) | Tested Fallback (`?renderer=webgl2`) |
|---|---|---|
| Active Backend Reported | `webgpu` | `webgl2` |
| GPU Adapter String | `intel / xe-2lpg` | `ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (8GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Output & Internal Resolution (Scaling) | 1920×1080 (DPR 1, scale 1) | 1920×1080 (DPR 1, scale 1) |
| Cold Launch to Ready | 3129 ms | 2756 ms |
| Warmed Sample Frames | 329 | 330 |
| Presented FPS (60 Hz Vsync-Capped) | **59.81 fps** | **59.99 fps** |
| Presented Frame Interval (p50 / p95 / p99) | 16.7 / 17.3 / 24.8 ms | 16.7 / 17.1 / 17.3 ms |
| **Active Render Work (avg / p50 / p95 / p99)** | **6.7 / 6.41 / 9.39 / 9.39 ms** | **4.27 / 4.12 / 4.65 / 5.54 ms** |
| Max Frame Time / Stalls > 50 ms | 25.4 ms / 0 | 17.8 ms / 0 |
| JS Heap Used | 90.11 MB | 98.29 MB |
| Retry Reset Latency | 153 ms | — |

## 2. Uncut Multi-Scenario Gameplay Recording & Visual Proofs

- **Uncut Gameplay Video:** `docs/verification/proofs/uncut-shootout-gameplay.webm` (demonstrates movement → ground shot → keeper save → live rebound + lifted flick → retry → 8.00 s timeout → retry).
- **Goal Proof Outcome:** `Goal (Legal goal scored in 2.83 s from inside the circle.)`
- **Console / Page Errors Observed:** 0

