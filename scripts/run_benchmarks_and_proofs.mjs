import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PROOFS_DIR = path.join(ROOT, 'docs', 'verification', 'proofs');
const REPORT_JSON = path.join(ROOT, 'docs', 'verification', 'benchmark-report.json');
const REPORT_MD = path.join(ROOT, 'docs', 'verification', 'benchmark-report.md');
const URL_BASE = 'http://127.0.0.1:4173';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Preview server did not start within ${timeoutMs}ms`);
}

async function launchBrowser() {
  const launchArgs = [
    '--enable-gpu',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
  ];
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({
        channel,
        headless: true,
        args: ['--headless=new', ...launchArgs],
      });
    } catch {
      // try next browser channel
    }
  }
  return await chromium.launch({ headless: true, args: launchArgs });
}

async function waitForDebugBridge(page) {
  await page.waitForFunction(() => Boolean(window.__UDDY_DEBUG__), null, { timeout: 25000 });
  await sleep(600);
}

async function runFrameBenchmark(page, durationMs = 5200) {
  await page.evaluate(() => {
    window.__UDDY_DEBUG__.retryAttempt();
    window.__UDDY_DEBUG__.setSyntheticInput({
      moveX: 0.05,
      moveZ: 1.0,
      sprint: true,
      aimNormX: 0.45,
      aimNormY: 0.2,
      chargingShot: false,
    });
    window.__UDDY_DEBUG__.resetFrameStats();
  });
  // Warm up 1 second of active movement before sampling
  await sleep(1000);
  await page.evaluate(() => window.__UDDY_DEBUG__.resetFrameStats());
  await sleep(durationMs);
  const stats = await page.evaluate(() => window.__UDDY_DEBUG__.getBenchmarkSummary());
  await page.evaluate(() => window.__UDDY_DEBUG__.setSyntheticInput(null));
  return stats;
}

async function main() {
  await fs.mkdir(PROOFS_DIR, { recursive: true });

  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: ROOT, stdio: 'pipe' },
  );

  const consoleErrors = [];
  let browser;
  try {
    await waitForServer(URL_BASE);
    browser = await launchBrowser();

    // =========================================================================
    // PASS A: Primary WebGPU Attempt + 8-Shot Visual Proof Sequence
    // =========================================================================
    const ctxA = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const pageA = await ctxA.newPage();
    pageA.on('pageerror', (err) => consoleErrors.push(`[WebGPU pageerror] ${err.message}`));
    pageA.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[WebGPU console.error] ${msg.text()}`);
    });

    const t0 = performance.now();
    await pageA.goto(`${URL_BASE}/?renderer=webgpu`, { waitUntil: 'domcontentloaded' });
    await waitForDebugBridge(pageA);
    const webgpuColdLoadMs = Math.round(performance.now() - t0);

    // Proof 7 (captured cleanly from start or after active setup): Let's test retry latency first
    const retryStart = performance.now();
    await pageA.evaluate(() => window.__UDDY_DEBUG__.retryAttempt());
    const retryMs = Math.round(performance.now() - retryStart);

    // Warmed-up WebGPU active encounter benchmark
    const webgpuBenchmark = await runFrameBenchmark(pageA, 5500);

    // Proof 1: Uncut Attempt Active (mid-dribble inside circle with HUD)
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setCameraMode('gameplay');
      window.__UDDY_DEBUG__.setLighting('floodlit');
      window.__UDDY_DEBUG__.setQuality('showcase');
      window.__UDDY_DEBUG__.setBallHalo(true);
      window.__UDDY_DEBUG__.retryAttempt();
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0.12,
        moveZ: 1.0,
        sprint: true,
        aimNormX: 0.55,
        aimNormY: 0.2,
        chargingShot: false,
      });
    });
    await sleep(1650);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '01-uncut-attempt-active.png') });

    // Proof 2: Athlete Close View (grip, fingers, face, fabric, socks, turf shoes, J-hook stick)
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({ moveX: 0, moveZ: 0.6, chargingShot: true });
      window.__UDDY_DEBUG__.setCameraMode('athlete_closeup');
    });
    await sleep(450);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '02-athlete-close-view.png') });

    // Proof 3: Keeper Encounter Close View (helmet+cage, smock, rectangular leg guards, kickers, blocker, stick)
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setCameraMode('keeper_closeup');
    });
    await sleep(450);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '03-keeper-encounter-close.png') });

    // Proof 6: Diffuse Daylight Materials Check (active play — no modal covering scene)
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.retryAttempt();
      window.__UDDY_DEBUG__.setLighting('daylight');
      window.__UDDY_DEBUG__.setQuality('showcase');
      window.__UDDY_DEBUG__.setCameraMode('gameplay');
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0.1,
        moveZ: 1.0,
        sprint: true,
        aimNormX: 0.45,
        aimNormY: 0.2,
      });
    });
    await sleep(1750);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '06-daylight-materials.png') });

    // Proof 7: Floodlit Hero Scene (active play from Uddy TV Gantry)
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setLighting('floodlit');
      window.__UDDY_DEBUG__.setCameraMode('broadcast_gantry');
    });
    await sleep(450);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '07-floodlit-hero-scene.png') });

    // Proof 8: Compatible Reduced Settings (active play)
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.retryAttempt();
      window.__UDDY_DEBUG__.setCameraMode('gameplay');
      window.__UDDY_DEBUG__.setQuality('compatible');
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: -0.1,
        moveZ: 1.0,
        sprint: true,
        aimNormX: 0.3,
        aimNormY: 0.15,
      });
    });
    await sleep(1700);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '08-compatible-reduced-settings.png') });

    // Restore Showcase Floodlit for Live Rebound + Goal proofs
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setQuality('showcase');
      window.__UDDY_DEBUG__.setLighting('floodlit');
      window.__UDDY_DEBUG__.setDifficulty('club_challenge');
      window.__UDDY_DEBUG__.setCameraMode('gameplay');
      window.__UDDY_DEBUG__.retryAttempt();
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0.0,
        moveZ: 1.0,
        sprint: true,
        aimNormX: 0.0,
        aimNormY: 0.1,
        chargingShot: false,
      });
    });
    // Wait until inside circle (~1.9s), then shoot straight at keeper center for guaranteed pad save & live rebound
    await sleep(1900);
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0,
        moveZ: 0.2,
        aimNormX: 0.0,
        aimNormY: 0.08,
        chargingShot: true,
      });
    });
    await sleep(320);
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0.15,
        moveZ: 0.4,
        aimNormX: 0.65,
        aimNormY: 0.15,
        chargingShot: false,
        releaseShotTriggered: true,
      });
    });
    await sleep(380);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '05-live-rebound-play.png') });

    // Now execute a clean corner goal shot for Proof 4
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.retryAttempt();
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: -0.22,
        moveZ: 1.0,
        sprint: true,
        aimNormX: 0.85,
        aimNormY: 0.2,
        chargingShot: false,
      });
    });
    await sleep(2100);
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0,
        moveZ: 0.3,
        aimNormX: 0.86,
        aimNormY: 0.18,
        chargingShot: true,
      });
    });
    await sleep(450);
    await pageA.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0,
        moveZ: 0,
        aimNormX: 0.86,
        aimNormY: 0.18,
        chargingShot: false,
        releaseShotTriggered: true,
      });
    });
    await sleep(650);
    await pageA.screenshot({ path: path.join(PROOFS_DIR, '04-goal-event-backboard.png') });
    const goalResultSample = await pageA.evaluate(() => window.__UDDY_DEBUG__.getLastResult());

    await ctxA.close();

    // =========================================================================
    // PASS B: Uncut Gameplay Video Recording (1280x720 WebM)
    // =========================================================================
    const ctxVideo = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: PROOFS_DIR, size: { width: 1280, height: 720 } },
    });
    const pageV = await ctxVideo.newPage();
    await pageV.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitForDebugBridge(pageV);
    await sleep(900); // Show attract screen briefly

    // Start via real button click
    await pageV.click('#btn-start-attempt');
    await pageV.evaluate(() => {
      window.__UDDY_DEBUG__.setDifficulty('first_go');
      window.__UDDY_DEBUG__.setBallHalo(true);
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: -0.18,
        moveZ: 1.0,
        sprint: true,
        aimNormX: 0.84,
        aimNormY: 0.2,
      });
    });
    await sleep(2150);
    // V-drag feint then charge & shoot
    await pageV.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0.1,
        moveZ: 0.6,
        feintTriggered: true,
        aimNormX: 0.85,
        aimNormY: 0.25,
        chargingShot: true,
      });
    });
    await sleep(500);
    await pageV.evaluate(() => {
      window.__UDDY_DEBUG__.setSyntheticInput({
        moveX: 0,
        moveZ: 0,
        aimNormX: 0.85,
        aimNormY: 0.25,
        chargingShot: false,
        releaseShotTriggered: true,
      });
    });
    await sleep(1600);
    // Reset cleanly on video to demonstrate retry flow
    await pageV.click('#btn-quick-retry');
    await sleep(1000);
    const videoFile = await pageV.video()?.path();
    await ctxVideo.close();
    const targetVideoPath = path.join(PROOFS_DIR, 'uncut-shootout-gameplay.webm');
    if (videoFile) {
      await fs.rm(targetVideoPath, { force: true });
      await fs.rename(videoFile, targetVideoPath);
    }

    // =========================================================================
    // PASS C: Forced WebGL2 Fallback Verification & Benchmark
    // =========================================================================
    const ctxGL = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const pageGL = await ctxGL.newPage();
    pageGL.on('pageerror', (err) => consoleErrors.push(`[WebGL2 pageerror] ${err.message}`));
    pageGL.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[WebGL2 console.error] ${msg.text()}`);
    });

    const tGL = performance.now();
    await pageGL.goto(`${URL_BASE}/?renderer=webgl2`, { waitUntil: 'domcontentloaded' });
    await waitForDebugBridge(pageGL);
    const webgl2ColdLoadMs = Math.round(performance.now() - tGL);
    const webgl2Benchmark = await runFrameBenchmark(pageGL, 5500);
    await pageGL.screenshot({ path: path.join(PROOFS_DIR, '09-webgl2-fallback-verify.png') });
    await ctxGL.close();

    // Write structured reports
    const report = {
      timestamp: new Date().toISOString(),
      machine: {
        cpu: 'Intel(R) Core(TM) Ultra 7 256V',
        ramGB: 15.66,
        gpuExpected: 'Intel(R) Arc(TM) 140V GPU (8GB shared)',
      },
      webgpuPass: {
        coldLoadMs: webgpuColdLoadMs,
        retryLatencyMs: retryMs,
        benchmark: webgpuBenchmark,
        sampleOutcome: goalResultSample,
      },
      webgl2Pass: {
        coldLoadMs: webgl2ColdLoadMs,
        benchmark: webgl2Benchmark,
      },
      consoleErrors,
      videoCapture: 'docs/verification/proofs/uncut-shootout-gameplay.webm',
      proofScreenshots: [
        '01-uncut-attempt-active.png',
        '02-athlete-close-view.png',
        '03-keeper-encounter-close.png',
        '04-goal-event-backboard.png',
        '05-live-rebound-play.png',
        '06-daylight-materials.png',
        '07-floodlit-hero-scene.png',
        '08-compatible-reduced-settings.png',
        '09-webgl2-fallback-verify.png',
      ],
    };

    await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

    const md = `# Uddy: Eight Seconds — Hardware Benchmark & Visual Proof Report

**Date:** ${report.timestamp}  
**Test Machine:** Intel Core Ultra 7 256V · 15.66 GB RAM · Intel Arc 140V GPU (Windows 11)  
**Build Under Test:** Production Vite Bundle (\`vite preview\`, 1920×1080 Showcase Preset)

## 1. Renderer Benchmark Results

| Metric | Primary (\`?renderer=webgpu\`) | Tested Fallback (\`?renderer=webgl2\`) |
|---|---|---|
| Active Backend Reported | \`${webgpuBenchmark.backend}\` | \`${webgl2Benchmark.backend}\` |
| GPU Adapter String | \`${webgpuBenchmark.gpuAdapter}\` | \`${webgl2Benchmark.gpuAdapter}\` |
| Resolution (DPR) | ${webgpuBenchmark.resolution.width}×${webgpuBenchmark.resolution.height} (${webgpuBenchmark.resolution.dpr}) | ${webgl2Benchmark.resolution.width}×${webgl2Benchmark.resolution.height} (${webgl2Benchmark.resolution.dpr}) |
| Cold Launch to Ready | ${webgpuColdLoadMs} ms | ${webgl2ColdLoadMs} ms |
| Warmed Sample Frames | ${webgpuBenchmark.frameCount} | ${webgl2Benchmark.frameCount} |
| Average FPS | **${webgpuBenchmark.avgFps} fps** | **${webgl2Benchmark.avgFps} fps** |
| p50 Frame Time | ${webgpuBenchmark.p50FrameMs} ms | ${webgl2Benchmark.p50FrameMs} ms |
| p95 Frame Time | ${webgpuBenchmark.p95FrameMs} ms | ${webgl2Benchmark.p95FrameMs} ms |
| p99 Frame Time | ${webgpuBenchmark.p99FrameMs} ms | ${webgl2Benchmark.p99FrameMs} ms |
| Max Frame Time | ${webgpuBenchmark.maxFrameMs} ms | ${webgl2Benchmark.maxFrameMs} ms |
| Stalls > 50 ms | ${webgpuBenchmark.stallsOver50ms} | ${webgl2Benchmark.stallsOver50ms} |
| JS Heap Used | ${webgpuBenchmark.jsHeapMB ?? 'n/a'} MB | ${webgl2Benchmark.jsHeapMB ?? 'n/a'} MB |
| Retry Reset Latency | ${retryMs} ms | — |

## 2. Uncut Gameplay Capture & Visual Proof Sequence

- **Uncut Gameplay Video:** \`docs/verification/proofs/uncut-shootout-gameplay.webm\`
- **Goal Proof Outcome:** \`${goalResultSample ? `${goalResultSample.outcome} (${goalResultSample.reason})` : 'Captured during active play'}\`
- **Console / Page Errors Observed:** ${consoleErrors.length}
${consoleErrors.map((e) => `- \`${e}\``).join('\n')}
`;

    await fs.writeFile(REPORT_MD, md, 'utf8');
    console.log(md);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
