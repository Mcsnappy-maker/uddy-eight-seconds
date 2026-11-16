---
name: playable-quality-review
description: Use when reviewing gameplay visuals, camera framing, animation quality, ball visibility, audio cues, accessibility, or performance benchmarks before accepting a milestone.
---

# Playable Quality Review

Prevent premature "done" claims by enforcing actual running-build visual inspection, WebGPU + WebGL2 fallback testing, uncut gameplay capture, and honest hardware benchmarking.

## Mandatory 8-Shot Visual Proof Sequence

Every visual milestone requires screenshots captured directly from the running packaged/production build (never editor-only previews or static concept art):

1. `01-uncut-attempt-active`: Active 8-second shoot-out play with HUD, ball, attacker, keeper, and goal clearly readable.
2. `02-athlete-close-view`: Close camera on attacker hands gripping the flat-faced field-hockey stick, posture, kit weave, socks, and turf shoes.
3. `03-keeper-encounter-close`: Close camera on goalkeeper in field-hockey helmet, chest protector, rectangular leg guards, strapped kickers, flat left blocker, and right-hand stick.
4. `04-goal-event-backboard`: Whole ball crossing inside aperture with net ripple and backboard visual response.
5. `05-live-rebound-play`: Keeper save/post deflection with clock still running and attacker able to play the rebound.
6. `06-daylight-materials`: Diffuse daylight lighting proving material quality, markings, and geometry without darkness hiding defects.
7. `07-floodlit-hero-scene`: Floodlit evening hero look with clearly visible ball and rich blue/gold contrast.
8. `08-compatible-reduced-settings`: Reduced/Compatible quality tier proving playability and readability without heavy effects.

## Uncut Gameplay & Visual Inspection Rules

- Record an uncut `.webm` video of a complete attempt (whistle → dribble → shot/save → rebound/goal → retry).
- Visually inspect every captured proof screenshot yourself before reporting completion. Reject floating feet, detached sticks, ice-hockey gear, or unreadable balls.

## Hardware Benchmark & Fallback Matrix

Test on the actual target machine while plugged in and record:
- **Both paths:** WebGPU primary (`?renderer=webgpu`) AND WebGL2 fallback (`?renderer=webgl2`).
- **Metrics:** Browser & exact GPU adapter string, resolution, quality tier, cold launch time, warmed-up average FPS, `p50` / `p95` / `p99` frame times (`<= 16.67 ms` target for 60 fps), count of active-play stalls `> 50 ms`, retry reset latency (`< 3000 ms`), and JS heap memory.
- **Honesty:** Never extrapolate or hide frame drops. If hardware or missing custom assets limit a target, log it clearly in `docs/verification/`.
