/**
 * Landing-page hero: the car rendered from its 3D model, with an x-ray scan sweeping across it. Both
 * pictures come from one camera (tools/render-images.mjs), so the layers line up exactly. The sweep is
 * two opposite translations, which the compositor runs on its own. Marked parts live inside the x-ray
 * layer, so they appear as the beam passes, and each opens in the 3D viewer.
 */
import { ArrowUpRight, ScanLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogEntry, CatalogImage, CatalogMedia } from '../../shared/manifest';
import { asset, navigate } from '../router';

export const srcSet = (img: CatalogImage) => img.files.map((f) => `${asset(f.url)} ${f.width}w`).join(', ');
export const largest = (img: CatalogImage) => asset(img.files[img.files.length - 1].url);

/** Short label for a part: no parenthesised details, nothing after "and". */
export const shortName = (name: string) => name.replace(/\s*\([^)]*\)/g, '').split(/ and | — /)[0].trim();

/** Hotspots far enough apart to tell apart; earlier ones (higher priority) win. */
function spaced(hotspots: CatalogMedia['hotspots'], aspect: number, min = 0.06) {
  const kept: CatalogMedia['hotspots'] = [];
  for (const h of hotspots) if (kept.every((k) => Math.hypot((k.x - h.x) * aspect, k.y - h.y) >= min)) kept.push(h);
  return kept;
}

type Corner = 'ur' | 'dr' | 'ul' | 'dl';
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

let measure: CanvasRenderingContext2D | null = null;
/** Width of a hotspot label as rendered (12 px semibold text, padding, border and arrow). */
function labelWidth(text: string): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text.length * 7 + 36;
  measure.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
  return measure.measureText(text).width + 38;
}

/**
 * Picks a corner for each label (up/down, right/left of its dot) at the size the picture is shown,
 * so labels clear each other, the other dots and the picture's edges; a hotspot whose label fits
 * nowhere is left out.
 */
function placeLabels(spots: CatalogMedia['hotspots'], width: number, height: number): Map<string, Corner> {
  const out = new Map<string, Corner>();
  const placed: Box[] = [];
  const dots = spots.map((s) => ({ x: s.x * width, y: s.y * height }));
  const hit = (a: Box, b: Box) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 4 && b.y < a.y + a.h + 4;
  spots.forEach((s, i) => {
    const w = labelWidth(shortName(s.name));
    const h = 26;
    const { x, y } = dots[i];
    const boxes: Record<Corner, Box> = {
      ur: { x: x + 15, y: y - 18 - h, w, h },
      dr: { x: x + 15, y: y + 18, w, h },
      ul: { x: x - 15 - w, y: y - 18 - h, w, h },
      dl: { x: x - 15 - w, y: y + 18, w, h },
    };
    const order: Corner[] = s.x > 0.6 ? ['ul', 'dl', 'ur', 'dr'] : ['ur', 'dr', 'ul', 'dl'];
    const corner = order.find((c) => {
      const b = boxes[c];
      if (b.x < 0 || b.y < 0 || b.x + b.w > width || b.y + b.h > height) return false;
      if (placed.some((p) => hit(p, b))) return false;
      return !dots.some((d, j) => j !== i && d.x > b.x - 10 && d.x < b.x + b.w + 10 && d.y > b.y - 10 && d.y < b.y + b.h + 10);
    });
    if (!corner) return;
    placed.push(boxes[corner]);
    out.set(s.id, corner);
  });
  return out;
}

const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;

export function HeroScanner({ entry }: { entry: CatalogEntry }) {
  const media = entry.media!;
  const { hero, xray } = media.images;
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const aspect = hero.width / hero.height;
  const candidates = useMemo(() => spaced(media.hotspots, aspect), [media, aspect]);
  const corners = useMemo(
    () => (width ? placeLabels(candidates, width, width / aspect) : new Map<string, Corner>()),
    // fontsReady: labels are measured again in the web font once it has loaded
    [candidates, width, aspect, fontsReady],
  );
  const spots = candidates.filter((h) => corners.has(h.id)).slice(0, 5);

  // labels are placed for the size the picture is shown at
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    document.fonts?.ready.then(() => setFontsReady(true));
    return () => ro.disconnect();
  }, []);

  // no sweeping while the hero is scrolled out of view
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const sizes = '(max-width: 860px) 100vw, 56vw';
  return (
    <div
      ref={ref}
      className={`scanner ${open ? 'open' : ''} ${onScreen ? '' : 'paused'}`}
      style={{ aspectRatio: `${hero.width} / ${hero.height}` }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
      onPointerUp={(e) => {
        // touch: a tap toggles the x-ray view (taps on a part open it instead)
        if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.spot')) setOpen((o) => !o);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <div className="scanner-floor" aria-hidden="true" />
      <img
        className="scanner-base"
        src={largest(hero)}
        srcSet={srcSet(hero)}
        sizes={sizes}
        width={hero.width}
        height={hero.height}
        alt={`${entry.make} ${entry.model} rendered from the atlas model`}
        fetchPriority="high"
        decoding="async"
      />
      <div className="xr-window">
        <div className="xr-layer">
          <img src={largest(xray)} srcSet={srcSet(xray)} sizes={sizes} width={xray.width} height={xray.height} alt="" decoding="async" />
          {spots.map((h) => (
            <button
              key={h.id}
              className={`spot ${corners.get(h.id)}`}
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, ['--c' as string]: h.color }}
              onClick={() => navigate(`/v/${entry.id}?part=${h.id}`)}
              title={h.name}
              aria-label={`Open ${h.name} in 3D`}
            >
              <span className="spot-dot" />
              <span className="spot-label">
                {shortName(h.name)} <ArrowUpRight size={12} />
              </span>
            </button>
          ))}
        </div>
      </div>
      {/* the beam rides on its own track so its glow is not clipped by the window */}
      <div className="xr-track" aria-hidden="true">
        <div className="xr-beam" />
      </div>
      <div className="scanner-hint" aria-hidden="true">
        <ScanLine size={14} /> {open ? 'X-ray · pick a part to open it in 3D' : `${canHover ? 'Hover' : 'Tap'} to see inside`}
      </div>
    </div>
  );
}
