// Frame rate while orbiting and exploding, and load timings, on a real GPU.
//
//   npm run dev   (in another terminal)
//   node tools/research/perf.mjs <vehicle-id> [device-pixel-ratio]
import { chromium } from '@playwright/test';

const vid = process.argv[2];
const base = process.env.ATLAS_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.argv[3] || 1) });
await page.goto(`${base}/v/${vid}`);
await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 60000 });
await page.waitForFunction(() => !window.__viewer.moving, null, { timeout: 10000 });
const res = await page.evaluate(async () => {
  const v = window.__viewer;
  const measure = async (label, fn, ms = 3000) => {
    const times = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((resolve) => {
      const step = (t) => {
        times.push(t - last);
        last = t;
        fn(t - t0);
        if (t - t0 < ms) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    times.shift();
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { label, fps: +(1000 / avg).toFixed(1), p95ms: +times[Math.floor(times.length * 0.95)].toFixed(1), stats: v.stats() };
  };
  const nav = performance.getEntriesByType('navigation')[0];
  const out = { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), vehicleReady: Math.round(performance.getEntriesByName('vehicle-ready')[0].startTime) };
  const t = v.controls.target.clone();
  const r = v.camera.position.clone().sub(t);
  const len = Math.hypot(r.x, r.z);
  out.orbit = await measure('orbit', (dt) => {
    v.camera.position.set(t.x + Math.sin(dt / 1000) * len, v.camera.position.y, t.z + Math.cos(dt / 1000) * len);
    v.camera.lookAt(t);
    v.invalidate();
  });
  out.explode = await measure('explode', (dt) => {
    if (dt < 20) v.model.applyExplode(1, new Set());
    v.invalidate();
  }, 2000);
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
