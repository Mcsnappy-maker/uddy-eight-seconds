# Uddy: Eight Seconds — Hardware Benchmark & Visual Proof Report

**Date:** 2026-11-16T19:39:34.452Z  
**Test Machine:** Intel Core Ultra 7 256V · 15.66 GB RAM · Intel Arc 140V GPU (Windows 11)  
**Build Under Test:** Production Vite Bundle (`vite preview`, 1920×1080 Showcase Preset)

## 1. Renderer Benchmark Results

| Metric | Primary (`?renderer=webgpu`) | Tested Fallback (`?renderer=webgl2`) |
|---|---|---|
| Active Backend Reported | `webgpu` | `webgl2` |
| GPU Adapter String | `intel / xe-2lpg` | `ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (8GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Resolution (DPR) | 1920×1080 (1) | 1920×1080 (1) |
| Cold Launch to Ready | 2478 ms | 2634 ms |
| Warmed Sample Frames | 331 | 330 |
| Average FPS | **60 fps** | **60 fps** |
| p50 Frame Time | 16.6 ms | 16.7 ms |
| p95 Frame Time | 17.1 ms | 17 ms |
| p99 Frame Time | 17.3 ms | 17.1 ms |
| Max Frame Time | 17.6 ms | 17.9 ms |
| Stalls > 50 ms | 0 | 0 |
| JS Heap Used | 63.95 MB | 60.55 MB |
| Retry Reset Latency | 760 ms | — |

## 2. Uncut Gameplay Capture & Visual Proof Sequence

- **Uncut Gameplay Video:** `docs/verification/proofs/uncut-shootout-gameplay.webm`
- **Goal Proof Outcome:** `Goal (Legal goal scored in 2.87 s from inside the circle.)`
- **Console / Page Errors Observed:** 0

