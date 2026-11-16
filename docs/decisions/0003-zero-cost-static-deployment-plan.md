# ADR 0003: £0 Static Hosting & Local Club Kiosk Deployment Plan

**Date:** 2026-11-16  
**Status:** Proposed Architecture Ready for Static Deployment (`vite.config.ts` uses relative `./` asset paths)

---

## 1. Zero-Cost Hosting Architecture

Because **Uddy: Eight Seconds** is a pure client-side TypeScript + Vite + Babylon.js web bundle (`dist/`) with **no backend database, no authentication server, and no cloud GPU streaming**, the compiled static files (`index.html`, `assets/*.js`, `assets/*.css`, `assets/models/*.glb`) can be hosted completely free on any static CDN:

| Option | Cost | Advantages for Uddingston Hockey Club | Limitations / Notes |
|---|---|---|---|
| **GitHub Pages** (`gh-pages` branch / GitHub Actions) | **£0** | Zero-config from existing GitHub repo; free HTTPS; automatic deploy on tag/push; supports relative paths (`base: './'`) | Public repo required for free private-org limits unless public; static bandwidth soft limit (100 GB/month) |
| **Cloudflare Pages** (GitHub integration) | **£0** | Unlimited bandwidth on free tier; global UK/EU edge caching; works cleanly on private GitHub repositories; custom domain SSL included | Requires free Cloudflare account linked to repo |
| **Local Offline Club Kiosk Package** | **£0** | Zero internet needed pitch-side or in clubhouse; launch via local HTTP server (`npx vite preview` or `python -m http.server 4173 -d dist`) | Browser `file://` direct open is blocked by CORS for `.glb`/ES modules, so a 1-click localhost runner (`LAUNCH_GAME.bat`) serves `dist/` locally |

---

## 2. Deployment & Offline Requirements

1. **Relative Asset Base (`base: './'`):** Configured in `vite.config.ts` so `public/assets/models/*.glb` resolves cleanly whether deployed at a domain root (`https://uddyhockey.pages.dev/`) or a GitHub Pages subpath (`https://username.github.io/UddyHockey/`).
2. **Offline Availability:** Zero runtime calls to external CDNs (`cdn.babylonjs.com`, external Google Fonts, or remote textures). Every shader, PBR texture, audio effect, and `.glb` mesh ships inside `dist/`.
3. **Browser Compatibility:** Ships WebGPU primary rendering (`WebGPUEngine`) with automatic WebGL2 fallback (`Engine`) for Chrome, Edge, Firefox, and Safari devices that lack WebGPU support.
