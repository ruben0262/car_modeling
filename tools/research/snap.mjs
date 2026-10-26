// Screenshots of the running viewer, optionally after scripted steps.
//
//   npm run dev   (in another terminal)
//   node tools/research/snap.mjs /tmp/shot "/v/<vehicle-id>?part=battery" --gpu \
//     --steps='[{"eval":"window.__store.getState().setTab(\"wiring\")","wait":1500}]'
//
// Steps: {click: selector} {press: key} {type: [selector, text]} {eval: js} {mouse: [x, y, click?]}
// plus wait (ms, default 1200) and shot (false to skip the screenshot). window.__store is the zustand
// store and window.__viewer the three.js viewer. Without --gpu it renders with SwiftShader (slow).
// --mobile shoots a 390×844 touch phone at 3× instead of a 1440×900 desktop; {tap: [x, y]} taps there.
import { chromium } from '@playwright/test';

const out = process.argv[2];
const path = process.argv[3] ?? '/';
const base = process.env.ATLAS_URL ?? 'http://localhost:5173';
const gpu = process.argv.includes('--gpu');
const stepsArg = process.argv.find((a) => a.startsWith('--steps='));
const steps = stepsArg ? JSON.parse(stepsArg.slice(8)) : [];
const args = gpu ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args, headless: true });
const mobile = process.argv.includes('--mobile');
const page = await browser.newPage(
  mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } },
);
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + path, { waitUntil: 'domcontentloaded' });
if (path.startsWith('/v/') && !path.includes('verification')) {
  await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 120000 }).catch((e) => logs.push('ready-timeout ' + e.message));
  // the camera swings in once the vehicle is ready; shoot the settled view
  await page.waitForFunction(() => !window.__viewer?.moving, null, { timeout: 10000 }).catch(() => {});
  console.log('ready after', Date.now() - t0, 'ms', await page.locator('[data-testid=perf]').textContent().catch(() => ''));
}
await page.waitForTimeout(1500);
let i = 0;
await page.screenshot({ path: `${out}-${i++}.png` });
for (const s of steps) {
  if (s.click) await page.click(s.click);
  if (s.press) await page.keyboard.press(s.press);
  if (s.type) await page.fill(s.type[0], s.type[1]);
  if (s.eval) await page.evaluate(s.eval);
  if (s.tap) await page.touchscreen.tap(s.tap[0], s.tap[1]);
  if (s.mouse) {
    await page.mouse.move(s.mouse[0], s.mouse[1]);
    if (s.mouse[2]) await page.mouse.click(s.mouse[0], s.mouse[1]);
  }
  await page.waitForTimeout(s.wait ?? 1200);
  if (s.shot !== false) await page.screenshot({ path: `${out}-${i++}.png` });
}
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
