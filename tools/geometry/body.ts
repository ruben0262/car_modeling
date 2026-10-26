/**
 * Body surface. The exterior is one parametric surface S(x, t):
 *
 *   x  — position along the car (ISO X, mm)
 *   t  — position around the cross-section, 0…6:
 *        0 left sill → 1 left beltline → 2 left roof/bonnet edge
 *        → 3 centreline → 4 right edge → 5 right beltline → 6 right sill
 *
 * The cross-section at each x comes from a station table in vehicle.yaml
 * (shapes.body), interpolated with monotone cubics so it never overshoots.
 * Panels are rectangles in (x, t) cut out of the same surface, so doors,
 * bonnet, glass and pillars always fit together with real shut lines.
 * Band boundaries may also be given as heights: "z:700" = where the lower
 * band reaches z = 700 mm (left), "zr:700" the same on the right.
 */
import * as THREE from 'three';
import { z } from 'zod';
import { def, merge, sub, type GenContext, type V3 } from './util';

const Station = z
  .object({
    x: z.array(z.number()).min(4),
    zSill: z.array(z.number()),
    zBelt: z.array(z.number()),
    zTop: z.array(z.number()),
    wLow: z.array(z.number()),
    wMax: z.array(z.number()),
    wBelt: z.array(z.number()),
    wTop: z.array(z.number()),
    crown: z.array(z.number()),
    arches: z.array(z.object({ x: z.number(), z: z.number(), r: z.number() }).strict()),
  })
  .strict();
export type BodyShape = z.infer<typeof Station>;

const KEYS = ['zSill', 'zBelt', 'zTop', 'wLow', 'wMax', 'wBelt', 'wTop', 'crown'] as const;
type Section = Record<(typeof KEYS)[number], number>;

/** Fritsch–Carlson monotone cubic interpolation over ascending xs. */
export function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    );
  };
}

type P2 = [number, number]; // (y, z)

/** Catmull–Rom through `points`; optional phantom neighbours control the end tangents. */
function catmull(points: P2[], samples: number, before?: P2, after?: P2): P2[] {
  const out: P2[] = [];
  const pts = [before ?? points[0], ...points, after ?? points[points.length - 1]];
  const segs = points.length - 1;
  for (let s = 0; s < segs; s++) {
    const [p0, p1, p2, p3] = [pts[s], pts[s + 1], pts[s + 2], pts[s + 3]];
    const steps = Math.max(2, Math.round(samples / segs));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

class Polyline {
  pts: P2[];
  cum: number[];
  constructor(pts: P2[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  get length() {
    return this.cum[this.cum.length - 1];
  }
  at(f: number): P2 {
    const L = Math.min(Math.max(f, 0), 1) * this.length;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < L) i++;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const u = (L - this.cum[i - 1]) / seg;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  /** Arc-length fraction where z first reaches `zq` (curve must be monotone in z). */
  fractionAtZ(zq: number): number {
    const p = this.pts;
    if (zq <= p[0][1]) return 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i][1] >= zq) {
        const u = (zq - p[i - 1][1]) / (p[i][1] - p[i - 1][1] || 1);
        return (this.cum[i - 1] + u * (this.cum[i] - this.cum[i - 1])) / this.length;
      }
    }
    return 1;
  }
}

export class BodySurface {
  private interp: Record<(typeof KEYS)[number], (x: number) => number>;
  readonly arches: BodyShape['arches'];
  readonly xMin: number;
  readonly xMax: number;
  private cache = new Map<number, { s: Section; lower: Polyline; glass: Polyline; top: Polyline }>();

  constructor(shape: BodyShape) {
    const order = shape.x.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const xs = order.map(([x]) => x);
    for (let i = 1; i < xs.length; i++) if (xs[i] === xs[i - 1]) throw new Error(`body shape: duplicate station x=${xs[i]}`);
    this.interp = {} as typeof this.interp;
    for (const k of KEYS) {
      const col = shape[k];
      if (col.length !== xs.length) throw new Error(`body shape: column ${k} has ${col.length} values, expected ${xs.length}`);
      this.interp[k] = monotone(
        xs,
        order.map(([, i]) => col[i]),
      );
    }
    this.arches = shape.arches;
    this.xMin = xs[0];
    this.xMax = xs[xs.length - 1];
  }

  section(x: number): Section {
    const s = {} as Section;
    for (const k of KEYS) s[k] = this.interp[k](x);
    return s;
  }

  private row(x: number) {
    const key = Math.round(x * 100) / 100;
    let r = this.cache.get(key);
    if (r) return r;
    const s = this.section(x);
    const H = Math.max(10, s.zBelt - s.zSill);
    const lower = new Polyline(
      catmull(
        [
          [s.wLow, s.zSill],
          [s.wMax, s.zSill + 0.3 * H],
          [s.wMax - 3, s.zSill + 0.74 * H],
          [s.wBelt, s.zBelt],
        ],
        48,
      ),
    );
    const edge: P2 = [s.wTop, s.zTop - s.crown];
    const glass = new Polyline([[s.wBelt, s.zBelt], edge]);
    // roof/bonnet: blends out of the glass line at the edge, horizontal at the centreline
    const mid: P2 = [s.wTop * 0.55, s.zTop - s.crown * 0.3];
    const top = new Polyline(catmull([edge, mid, [0, s.zTop]], 36, [s.wBelt, s.zBelt], [-mid[0], mid[1]]));
    r = { s, lower, glass, top };
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }

  /** Surface point (ISO mm) for x and section parameter t ∈ [0, 6]. */
  point(x: number, t: number): V3 {
    const right = t > 3;
    const tt = right ? 6 - t : t;
    const r = this.row(x);
    const band = Math.min(2, Math.floor(tt));
    const f = tt - band;
    const [y, zz] = band === 0 ? r.lower.at(f) : band === 1 ? r.glass.at(f) : r.top.at(f);
    return [x, right ? -y : y, zz];
  }

  /** t value (0…1 band) where the lower band reaches height z at station x; heights above the belt continue into the glass band. */
  tAtZ(x: number, zq: number): number {
    const r = this.row(x);
    if (zq <= r.s.zBelt) return r.lower.fractionAtZ(zq);
    return 1 + Math.min(1, (zq - r.s.zBelt) / Math.max(1, r.s.zTop - r.s.crown - r.s.zBelt));
  }

  /** Lateral surface offset on the lower band at (x, z) — used to keep arch edges on the surface. */
  yAt(x: number, zq: number): number {
    const r = this.row(x);
    return r.lower.at(r.lower.fractionAtZ(zq))[0];
  }

  bandLength(x: number, band: number): number {
    const r = this.row(x);
    return [r.lower.length, r.glass.length, r.top.length][Math.min(2, Math.max(0, band))];
  }
}

const surfaces = new WeakMap<object, BodySurface>();
export function bodySurface(ctx: GenContext): BodySurface {
  const raw = ctx.shapes.body;
  if (!raw || typeof raw !== 'object') throw new Error('body generators need vehicle shapes.body');
  let s = surfaces.get(raw);
  if (!s) {
    s = new BodySurface(Station.parse(raw));
    surfaces.set(raw, s);
  }
  return s;
}

const TBound = z.union([z.number().min(0).max(6), z.string().regex(/^zr?:-?\d+(\.\d+)?$/)]);

function resolveT(surface: BodySurface, x: number, b: number | string): number {
  if (typeof b === 'number') return b;
  const right = b.startsWith('zr:');
  const zq = Number(b.slice(right ? 3 : 2));
  const t = surface.tAtZ(x, zq);
  return right ? 6 - t : t;
}

export const bodyPanel = def(
  z
    .object({
      x: z.tuple([z.number(), z.number()]),
      t: z.tuple([TBound, TBound]),
      gap: z.number().min(0).default(3),
      inset: z.number().default(0),
      res: z.number().positive().default(1),
      /** Cut wheel arches out of this panel (default: only when it reaches the lower band). */
      arches: z.boolean().optional(),
      mat: z.string().optional(),
    })
    .strict(),
  (p, ctx) => {
    const S = bodySurface(ctx);
    let [x0, x1] = [Math.min(...p.x), Math.max(...p.x)];
    const g = p.gap / 2;
    if (x0 > S.xMin + 1) x0 += g;
    if (x1 < S.xMax - 1) x1 -= g;
    const nx = Math.max(2, Math.ceil(((x1 - x0) / 22) * p.res));
    const xMid = (x0 + x1) / 2;
    const tA = resolveT(S, xMid, p.t[0]);
    const tB = resolveT(S, xMid, p.t[1]);
    const lo = Math.min(tA, tB);
    const hi = Math.max(tA, tB);
    const nt = Math.max(2, Math.ceil((hi - lo) * 16 * p.res));
    const gapT = (tb: number) => (tb <= 0.001 || tb >= 5.999 ? 0 : g / Math.max(30, S.bandLength(xMid, Math.floor(tb <= 3 ? tb : 6 - tb))));

    const positions: number[] = [];
    const inside: boolean[] = [];
    const arches = S.arches;
    const cutArches = p.arches ?? (lo < 1 || hi > 5);
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      // z-defined boundaries are re-resolved per row so they follow a constant height
      let a = resolveT(S, x, p.t[0]);
      let b = resolveT(S, x, p.t[1]);
      if (a > b) [a, b] = [b, a];
      a += gapT(a);
      b -= gapT(b);
      for (let j = 0; j <= nt; j++) {
        const t = a + ((b - a) * j) / nt;
        const pt = S.point(x, t);
        positions.push(...pt);
        inside.push(cutArches && (t < 1 || t > 5) && arches.some((c) => (pt[0] - c.x) ** 2 + (pt[2] - c.z) ** 2 < (c.r + g) ** 2));
      }
    }
    const idx = (i: number, j: number) => i * (nt + 1) + j;
    const index: number[] = [];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nt; j++) {
        const q = [idx(i, j), idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1)];
        for (const tri of [
          [q[0], q[1], q[2]],
          [q[2], q[1], q[3]],
        ])
          if (!tri.every((v) => inside[v])) index.push(...tri);
      }
    // snap remaining arch-interior vertices onto the arch circle, back on the surface
    for (let v = 0; v < inside.length; v++) {
      if (!inside[v]) continue;
      const x = positions[v * 3];
      const zz = positions[v * 3 + 2];
      const c = arches.reduce((best, a) => ((x - a.x) ** 2 + (zz - a.z) ** 2 < (x - best.x) ** 2 + (zz - best.z) ** 2 ? a : best));
      const ang = Math.atan2(zz - c.z, x - c.x);
      const nxp = c.x + Math.cos(ang) * (c.r + g);
      const nzp = c.z + Math.sin(ang) * (c.r + g);
      const sign = positions[v * 3 + 1] < 0 ? -1 : 1;
      positions[v * 3] = nxp;
      positions[v * 3 + 1] = sign * S.yAt(nxp, nzp);
      positions[v * 3 + 2] = nzp;
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    if (p.inset !== 0) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const nor = geo.attributes.normal as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++)
        pos.setXYZ(v, pos.getX(v) - nor.getX(v) * p.inset, pos.getY(v) - nor.getY(v) * p.inset, pos.getZ(v) - nor.getZ(v) * p.inset);
    }
    geo = dropDegenerate(geo);
    return [sub(geo, p.mat ?? '')];
  },
);

function dropDegenerate(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index!;
  const keep: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    if (area > 0.5) keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  geo.setIndex(keep);
  return geo;
}

/** Closing face at the front or rear end of the surface, clipped to a height range. */
export const bodyCap = def(
  z
    .object({
      end: z.enum(['front', 'rear']),
      z: z.tuple([z.number(), z.number()]),
      /** X shift per metre of height (positive leans the top rearwards for 'front'). */
      rake: z.number().default(0),
      mat: z.string().optional(),
    })
    .strict(),
  (p, ctx) => {
    const S = bodySurface(ctx);
    const xEnd = p.end === 'front' ? S.xMax : S.xMin;
    const ring: [number, number][] = [];
    for (let i = 0; i <= 120; i++) {
      const pt = S.point(xEnd, (i / 120) * 6);
      ring.push([pt[1], pt[2]]);
    }
    const clipped = clipZ(ring, p.z[0], p.z[1]);
    if (clipped.length < 3) return [];
    const tris = THREE.ShapeUtils.triangulateShape(
      clipped.map(([a, b]) => new THREE.Vector2(a, b)),
      [],
    );
    const zRef = p.z[0];
    const pos: number[] = [];
    for (const [a, b, c] of tris)
      for (const k of p.end === 'front' ? [a, c, b] : [a, b, c]) {
        const [y, zz] = clipped[k];
        const dx = ((zz - zRef) / 1000) * p.rake;
        pos.push(p.end === 'front' ? xEnd - dx : xEnd + dx, y, zz);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    // ensure the face points away from the car
    const n = geo.attributes.normal.getX(0);
    if ((p.end === 'front' && n < 0) || (p.end === 'rear' && n > 0)) {
      const arr = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < arr.length; i += 9)
        for (let c = 0; c < 3; c++) {
          const t = arr[i + 3 + c];
          arr[i + 3 + c] = arr[i + 6 + c];
          arr[i + 6 + c] = t;
        }
      geo.computeVertexNormals();
    }
    return [sub(merge([geo]), p.mat ?? '')];
  },
);

/** Sutherland–Hodgman clip of a closed (y, z) polygon to z0 ≤ z ≤ z1. */
function clipZ(poly: [number, number][], z0: number, z1: number): [number, number][] {
  const clip = (pts: [number, number][], keep: (p: [number, number]) => boolean, zc: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) {
        const u = (zc - a[1]) / (b[1] - a[1]);
        out.push([a[0] + (b[0] - a[0]) * u, zc]);
      }
    }
    return out;
  };
  return clip(
    clip(poly, (p) => p[1] >= z0, z0),
    (p) => p[1] <= z1,
    z1,
  );
}

/** Black plastic wheel-arch extension following an arch circle, standing proud of the body side. */
export const archFlare = def(
  z
    .object({
      arch: z.number().int().min(0),
      from: z.number().default(-8),
      to: z.number().default(188),
      width: z.number().default(62),
      proud: z.number().default(26),
      depth: z.number().default(40),
    })
    .strict(),
  (p, ctx) => {
    const S = bodySurface(ctx);
    const a = S.arches[p.arch];
    if (!a) throw new Error(`arch-flare: no arch #${p.arch}`);
    const steps = 64;
    const pos: number[] = [];
    const index: number[] = [];
    // ring cross-section: (radial offset, lateral offset) around the flare lip
    const prof: [number, number][] = [
      [0, -p.depth],
      [0, 0],
      [p.width * 0.15, p.proud],
      [p.width * 0.8, p.proud * 0.85],
      [p.width, 0],
    ];
    for (let i = 0; i <= steps; i++) {
      const ang = ((180 - (p.from + ((p.to - p.from) * i) / steps)) * Math.PI) / 180;
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      for (const [dr, dy] of prof) {
        const x = a.x + cx * (a.r + dr);
        const zz = a.z + cz * (a.r + dr);
        const y = S.yAt(x, Math.max(zz, a.z - a.r * 0.2)) + dy;
        pos.push(x, y, zz);
      }
    }
    const m = prof.length;
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < m - 1; j++) {
        const q0 = i * m + j;
        const q1 = (i + 1) * m + j;
        index.push(q0, q1, q0 + 1, q0 + 1, q1, q1 + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return [sub(geo, 'trim-black')];
  },
);

/** Inner wheel-arch liner: part cylinder around the wheel. */
export const archLiner = def(
  z
    .object({
      arch: z.number().int().min(0),
      y: z.tuple([z.number(), z.number()]),
      r: z.number().optional(),
      from: z.number().default(-12),
      to: z.number().default(192),
    })
    .strict(),
  (p, ctx) => {
    const S = bodySurface(ctx);
    const a = S.arches[p.arch];
    const r = p.r ?? a.r - 12;
    const steps = 56;
    const pos: number[] = [];
    const index: number[] = [];
    const [y0, y1] = p.y;
    for (let i = 0; i <= steps; i++) {
      const ang = ((p.from + ((p.to - p.from) * i) / steps) * Math.PI) / 180;
      const x = a.x + Math.cos(ang) * r;
      const zz = a.z + Math.sin(ang) * r;
      pos.push(x, y0, zz, x, y1, zz);
    }
    for (let i = 0; i < steps; i++) {
      const q = i * 2;
      index.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return [sub(geo, 'trim-black')];
  },
);
