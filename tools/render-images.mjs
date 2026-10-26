// Renders a vehicle's catalogue images from its 3D model: the home-page hero (painted and x-ray, from the
// same camera so one can be revealed over the other), the exploded systems and its wiring, plus where a
// few parts sit on the x-ray image (listed in priority order: the home page keeps those that do not crowd). Writes them to the vehicle's data folder
// (media/); the data build copies them next to the geometry with content-hashed names.
//
//   npm run dev   (in another terminal)
//   node tools/render-images.mjs <vehicle-id> [--hotspots=turbocharger,battery,ecm] [--gpu]
//
// Hotspots default to the ones already in media/media.json. Only parts that are actually visible on the
// x-ray image are kept. Re-run after the model changes: the data build warns when the images are older.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const vid = process.argv[2];
if (!vid || vid.startsWith('--')) {
  console.error('usage: node tools/render-images.mjs <vehicle-id> [--hotspots=a,b,c] [--gpu]');
  process.exit(1);
}
const base = process.env.ATLAS_URL ?? 'http://localhost:5173';
const gpu = process.argv.includes('--gpu');
const hotspotArg = process.argv.find((a) => a.startsWith('--hotspots='));

function findVehicleDir(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const found = findVehicleDir(p);
      if (found) return found;
    } else if (entry === 'vehicle.yaml' && new RegExp(`^id:\\s*${vid}\\s*$`, 'm').test(readFileSync(p, 'utf8'))) return dir;
  }
  return null;
}
const vehicleDir = findVehicleDir(join(process.cwd(), 'data', 'vehicles'));
if (!vehicleDir) {
  console.error(`no data/vehicles/**/vehicle.yaml has id: ${vid}`);
  process.exit(1);
}
const outDir = join(vehicleDir, 'media');
const indexPath = join(outDir, 'media.json');
const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : null;
const wanted = hotspotArg ? hotspotArg.slice(11).split(',').filter(Boolean) : (previous?.hotspots ?? []).map((h) => h.id);

// one camera for the hero pair; the rest frame what they show
const SHOTS = [
  { name: 'hero', widths: [1600, 800], camera: 'car', state: { xray: false, explode: 0, colorMode: 'realistic' }, pairWith: 'xray' },
  { name: 'xray', widths: [1600, 800], camera: 'car', state: { xray: true, explode: 0, colorMode: 'realistic' }, hotspots: true },
  { name: 'exploded', widths: [1200, 600], camera: 'all', state: { xray: false, explode: 1, colorMode: 'systems' } },
  { name: 'wiring', widths: [1200, 600], camera: 'engine', state: { xray: true, explode: 0, colorMode: 'realistic' }, select: 'ecm' },
];

const args = gpu ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args });
// rendered at twice the output size and scaled down: smooth edges without depending on MSAA
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto(`${base}/v/${vid}`);
await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 120000 });
await page.addStyleTag({ content: '.viewer-root{inset:0!important;background:none!important}.topbar,.rail,.tools,.panel,.viewbar,.title-block,.perf,.anchor-label,.hovertip{display:none!important}' });

await page.evaluate(() => {
  const v = window.__viewer;
  v.floor.visible = false;
  v.setInsets({ left: 0, right: 0, top: 0, bottom: 0 });
  window.__render = {
    settle: async () => {
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 600 && v.moving; i++) await new Promise((r) => setTimeout(r, 16));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    /** Copy of the canvas right after a render (the drawing buffer is only valid until the frame is shown). */
    grab: () => {
      v.renderer.setPixelRatio(2);
      v.setInsets({ left: 0, right: 0, top: 0, bottom: 0 });
      v.renderer.render(v.scene, v.camera);
      const src = v.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      return c;
    },
    /** Bounding rectangle of everything not transparent. */
    content: (c) => {
      const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3] > 6) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      return { x0, y0, x1, y1 };
    },
    /** Crops and scales down in halving steps (a single large step aliases). */
    scaled: (c, r, width) => {
      let cur = document.createElement('canvas');
      cur.width = r.w;
      cur.height = r.h;
      cur.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      while (cur.width / 2 >= width) {
        const next = document.createElement('canvas');
        next.width = Math.round(cur.width / 2);
        next.height = Math.round(cur.height / 2);
        const g = next.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(cur, 0, 0, next.width, next.height);
        cur = next;
      }
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.round((r.h * width) / r.w);
      const g = out.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, 0, 0, out.width, out.height);
      return out;
    },
  };
});

async function setup(shot) {
  await page.evaluate(async (shot) => {
    const v = window.__viewer;
    const st = window.__store.getState();
    st.reset();
    st.setXray(shot.state.xray);
    st.setExplode(shot.state.explode);
    st.setColorMode(shot.state.colorMode);
    st.select(shot.select ?? null);
    await window.__render.settle();
    const Vec = v.camera.position.constructor;
    const box = v.model.boundsAll().clone();
    if (shot.camera === 'car') {
      // the whole car, as the viewer's home view but a little lower
      box.min.set(-0.96, 0, -3.62);
      box.max.set(0.96, 1.74, 0.88);
      v.frame(box, new Vec(1.05, 0.5, 1).normalize(), false, 0.95);
    } else if (shot.camera === 'all') {
      v.frame(box, new Vec(1.05, 0.62, 1).normalize(), false, 0.95);
    } else {
      // engine bay, as the viewer's "Engine bay" view
      box.min.set(-0.8, 0.2, -0.5);
      box.max.set(0.8, 1.1, 0.88);
      v.frame(box, new Vec(0.25, 1, 0.55).normalize(), false, 1.05);
    }
    if (shot.select) for (let i = 0; i < 200 && !v.wires.count; i++) await new Promise((r) => setTimeout(r, 25));
    await window.__render.settle();
  }, shot);
}

/** Where each wanted part shows on the x-ray image (canvas pixels), tried at its centre and a few inner points. */
async function locateHotspots(ids) {
  return page.evaluate((ids) => {
    const v = window.__viewer;
    const m = v.model;
    const Vec = v.camera.position.constructor;
    const canvas = v.renderer.domElement;
    return ids.map((id) => {
      if (!m.nodes.has(id)) return { id, missing: true };
      const box = m.boundsOf(id);
      if (box.isEmpty()) return { id, hidden: true };
      const c = box.getCenter(new Vec());
      const s = box.getSize(new Vec()).multiplyScalar(0.3);
      const offsets = [[0, 0, 0], [1, 1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, 1], [0, 1, 0]];
      for (const [x, y, z] of offsets) {
        const ndc = c.clone().add(new Vec(x * s.x, y * s.y, z * s.z)).project(v.camera);
        // the part must be what a click there would pick (x-ray panels never block it)
        const seen = v.pickAt(ndc.x, ndc.y);
        if (seen && m.isAncestor(id, seen)) return { id, x: ((ndc.x + 1) / 2) * canvas.width, y: ((1 - ndc.y) / 2) * canvas.height };
      }
      return { id, occluded: true };
    });
  }, ids);
}

mkdirSync(outDir, { recursive: true });
const images = {};
let hotspots = [];
let pair = null;
for (const shot of SHOTS) {
  await setup(shot);
  const info = await page.evaluate((shot) => {
    const R = window.__render;
    window.__shots ??= {};
    const c = R.grab();
    window.__shots[shot.name] = c;
    return { box: R.content(c), w: c.width, h: c.height };
  }, shot);
  if (shot.hotspots) hotspots = wanted.length ? await locateHotspots(wanted) : [];
  // the hero pair shares one crop so the two images stay aligned
  const box = shot.pairWith ? null : info.box;
  if (shot.pairWith) pair = { name: shot.name, box: info.box, w: info.w, h: info.h };
  if (shot.name === 'xray' && pair) {
    const u = { x0: Math.min(pair.box.x0, info.box.x0), y0: Math.min(pair.box.y0, info.box.y0), x1: Math.max(pair.box.x1, info.box.x1), y1: Math.max(pair.box.y1, info.box.y1) };
    await finish([pair.name, 'xray'], u, info, SHOTS.find((s) => s.name === pair.name).widths);
  } else if (box) await finish([shot.name], box, info, shot.widths);
}

async function finish(names, box, info, widths) {
  const pad = Math.round(0.03 * Math.max(box.x1 - box.x0, box.y1 - box.y0));
  const r = { x: Math.max(0, box.x0 - pad), y: Math.max(0, box.y0 - pad) };
  r.w = Math.min(info.w, box.x1 + pad) - r.x;
  r.h = Math.min(info.h, box.y1 + pad) - r.y;
  for (const name of names) {
    const files = [];
    for (const width of widths) {
      const url = await page.evaluate(({ name, r, width }) => window.__render.scaled(window.__shots[name], r, width).toDataURL('image/webp', 0.86), { name, r, width });
      const file = `${name}-${width}.webp`;
      writeFileSync(join(outDir, file), Buffer.from(url.split(',')[1], 'base64'));
      files.push({ width, file });
    }
    images[name] = { width: widths[0], height: Math.round((r.h * widths[0]) / r.w), files };
    if (name === 'xray')
      hotspots = hotspots.map((h) => (h.x === undefined ? h : { id: h.id, x: +((h.x - r.x) / r.w).toFixed(4), y: +((h.y - r.y) / r.h).toFixed(4) }));
  }
}

const modelHash = await page.evaluate(() => window.__store.getState().manifest.chunks.filter((c) => c.role === 'system').map((c) => c.url.split('.').slice(-2, -1)[0]).sort().join(''));
for (const h of hotspots) if (h.x === undefined) console.warn(`  ▲ hotspot ${h.id}: ${h.missing ? 'no such component' : h.hidden ? 'not shown' : 'hidden behind other parts'} — left out`);
const media = {
  rendered: new Date().toISOString().slice(0, 10),
  modelHash,
  images,
  hotspots: hotspots.filter((h) => h.x !== undefined && h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1),
};
writeFileSync(indexPath, JSON.stringify(media, null, 2) + '\n');
console.log(`${Object.keys(images).length} images and ${media.hotspots.length} hotspots → ${relative(process.cwd(), outDir)}`);
await browser.close();
