/** Suspension, steering and driveline generators. */
import * as THREE from 'three';
import { z } from 'zod';
import { alignY, beam, between, crease, cylinder, def, lathe, merge, roundedBox, sphere, sub, tube, v3, zV3, type Sub, type V3 } from './util';

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(
    private r: number,
    private h: number,
    private turns: number,
    private wire: number,
  ) {
    super();
  }
  override getPoint(u: number, target = new THREE.Vector3()) {
    const t = u * this.turns;
    const e = Math.min(0.85, this.turns / 4);
    const dead = 2.1 * this.wire;
    const live = this.h - 2 * dead - 2 * this.wire;
    let zz: number;
    if (t < e) zz = (dead * t) / e;
    else if (t > this.turns - e) zz = dead + live + (dead * (t - (this.turns - e))) / e;
    else zz = dead + (live * (t - e)) / (this.turns - 2 * e);
    const a = t * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, Math.sin(a) * this.r, zz + this.wire);
  }
}

export function coil(r: number, wire: number, h: number, turns: number): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new Helix(r, h, turns, wire), Math.round(turns * 56), wire, 10, false);
}

export const coilSpring = def(
  z.object({ r: z.number(), wire: z.number(), h: z.number(), turns: z.number(), mat: z.string().default('steel-black') }).strict(),
  (p) => [sub(coil(p.r, p.wire, p.h, p.turns), p.mat)],
);

/**
 * MacPherson strut, laid out along local +Z from the lower clamp (z = 0).
 * `part` selects one sub-component so the strut can be broken down.
 */
export const strut = def(
  z
    .object({
      bodyLen: z.number().default(330),
      bodyR: z.number().default(26),
      seatZ: z.number().default(300),
      seatR: z.number().default(82),
      topZ: z.number().default(560),
      coilR: z.number().default(68),
      wire: z.number().default(6.8),
      turns: z.number().default(5.5),
      bracket: z.boolean().default(false),
      part: z.enum(['assembly', 'damper', 'spring', 'top-mount']).default('assembly'),
    })
    .strict(),
  (p) => {
    const damper = (): Sub[] => {
      const body = alignY(cylinder(p.bodyR, p.bodyLen, 32, 2), 'z').translate(0, 0, p.bodyLen / 2);
      const rod = alignY(cylinder(11, p.topZ - p.bodyLen + 10, 20), 'z').translate(0, 0, (p.topZ + p.bodyLen) / 2);
      const seat = lathe(
        [
          [p.bodyR, -4],
          [p.seatR, -4],
          [p.seatR + 4, 8],
          [p.seatR, 10],
          [p.bodyR, 4],
        ],
        48,
      );
      alignY(seat, 'z').translate(0, 0, p.seatZ);
      const steel = [body, rod, seat];
      if (p.bracket) steel.push(roundedBox([70, 60, 90], 6).translate(0, -30, 45));
      const bootProfile: [number, number][] = [];
      const bootLen = Math.min(160, p.topZ - p.bodyLen - 40);
      for (let i = 0; i <= 12; i++) bootProfile.push([i % 2 ? 30 : 36, (bootLen * i) / 12]);
      const boot = alignY(lathe([[0, 0], ...bootProfile, [0, bootLen]], 28), 'z').translate(0, 0, p.bodyLen + 4);
      return [sub(merge(steel), 'steel-black'), sub(merge([boot]), 'rubber')];
    };
    const spring = (): Sub[] => [sub(coil(p.coilR, p.wire, p.topZ - p.seatZ - 30, p.turns).translate(0, 0, p.seatZ + 6), 'steel-black')];
    const topMount = (): Sub[] => {
      const z0 = p.topZ - 26;
      const upper = alignY(lathe([[14, -6], [p.coilR + 16, -6], [p.coilR + 18, 6], [p.coilR - 10, 14], [14, 14]], 48), 'z').translate(0, 0, z0);
      const bearing = alignY(cylinder(p.coilR - 8, 22, 40, 3), 'z').translate(0, 0, z0 + 24);
      const plate = alignY(cylinder(p.coilR - 4, 6, 40, 1), 'z').translate(0, 0, z0 + 38);
      const studs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        studs.push(alignY(cylinder(5, 28, 8), 'z').translate(Math.cos(a) * (p.coilR - 22), Math.sin(a) * (p.coilR - 22), z0 + 50));
      }
      return [sub(merge([upper, plate, ...studs]), 'steel-zinc'), sub(merge([bearing]), 'rubber')];
    };
    if (p.part === 'damper') return damper();
    if (p.part === 'spring') return spring();
    if (p.part === 'top-mount') return topMount();
    return [...damper(), ...spring(), ...topMount()];
  },
);

const zEye = z
  .object({
    at: zV3,
    axis: zV3.default([1, 0, 0]),
    r: z.number().default(26),
    len: z.number().default(50),
    type: z.enum(['bush', 'ball']).default('bush'),
  })
  .strict();

/** Arms, links and rods: rectangular beams through `points`, with bushes or ball joints. */
export const link = def(
  z
    .object({
      points: z.array(zV3).min(2),
      w: z.number().default(36),
      h: z.number().default(26),
      round: z.boolean().default(false),
      eyes: z.array(zEye).default([]),
      mat: z.string().default('steel-black'),
    })
    .strict(),
  (p) => {
    const metal: THREE.BufferGeometry[] = [];
    const rubber: THREE.BufferGeometry[] = [];
    if (p.round) metal.push(tube(p.points as V3[], p.w / 2, { tension: 0.2 }));
    else for (let i = 0; i < p.points.length - 1; i++) metal.push(crease(beam(p.points[i] as V3, p.points[i + 1] as V3, p.w, p.h, 5)));
    for (const e of p.eyes) {
      if (e.type === 'ball') {
        metal.push(sphere(e.r * 0.62).translate(e.at[0], e.at[1], e.at[2]));
        const stud = cylinder(e.r * 0.35, e.len, 16);
        const dir = v3(e.axis as V3).normalize();
        between(stud, e.at as V3, v3(e.at as V3).addScaledVector(dir, e.len));
        metal.push(stud);
        continue;
      }
      const dir = v3(e.axis as V3).normalize();
      const a = v3(e.at as V3).addScaledVector(dir, -e.len / 2);
      const b = v3(e.at as V3).addScaledVector(dir, e.len / 2);
      metal.push(between(cylinder(e.r, e.len, 24, 2), a, b));
      const ra = v3(e.at as V3).addScaledVector(dir, -e.len / 2 - 4);
      rubber.push(between(cylinder(e.r * 0.62, e.len + 8, 20), ra, b.clone().addScaledVector(dir, 4)));
    }
    const out: Sub[] = [sub(merge(metal), p.mat)];
    if (rubber.length) out.push(sub(merge(rubber), 'rubber'));
    return out;
  },
);

function bellows(r0: number, r1: number, len: number, folds: number): THREE.BufferGeometry {
  const prof: [number, number][] = [[0, 0], [r0, 0]];
  for (let i = 1; i < folds * 2; i++) {
    const u = i / (folds * 2);
    const r = r0 + (r1 - r0) * u;
    prof.push([i % 2 ? r * 1.08 + 3 : r * 0.92, u * len]);
  }
  prof.push([r1, len], [0, len]);
  return lathe(prof, 28);
}

/** Half-shaft with inner (plunging) and outer (fixed) CV joints and boots. */
export const driveshaft = def(
  z
    .object({
      from: zV3,
      to: zV3,
      r: z.number().default(13),
      inner: z.object({ r: z.number().default(48), len: z.number().default(78) }).strict().default({ r: 48, len: 78 }),
      outer: z.object({ r: z.number().default(50), len: z.number().default(70) }).strict().default({ r: 50, len: 70 }),
      bearing: z.number().optional(),
    })
    .strict(),
  (p) => {
    const A = v3(p.from as V3);
    const B = v3(p.to as V3);
    const L = A.distanceTo(B);
    const steel: THREE.BufferGeometry[] = [];
    const rubber: THREE.BufferGeometry[] = [];
    // short shafts (e.g. the gearbox-side front shaft) get proportionally shorter boots
    const bootIn = Math.min(110, 0.22 * L);
    const bootOut = Math.min(100, 0.2 * L);
    steel.push(cylinder(p.inner.r, p.inner.len, 32, 4).translate(0, p.inner.len / 2, 0));
    rubber.push(bellows(p.inner.r * 0.85, p.r + 6, bootIn, 5).translate(0, p.inner.len - 4, 0));
    steel.push(cylinder(p.r, Math.max(10, L - p.inner.len - p.outer.len - bootIn - bootOut + 20), 16).translate(0, (p.inner.len + bootIn + L - p.outer.len - bootOut) / 2, 0));
    rubber.push(bellows(p.r + 6, p.outer.r * 0.9, bootOut, 5).translate(0, L - p.outer.len - bootOut + 4, 0));
    steel.push(lathe([[0, 0], [p.outer.r * 0.7, 0], [p.outer.r, p.outer.len * 0.45], [p.outer.r * 0.75, p.outer.len], [16, p.outer.len], [16, p.outer.len + 40], [0, p.outer.len + 40]], 32).translate(0, L - p.outer.len, 0));
    if (p.bearing) steel.push(cylinder(36, 28, 24, 2).translate(0, p.bearing, 0));
    const orient = (g: THREE.BufferGeometry) => between(g, A, B);
    return [sub(orient(merge(steel)), 'steel-black'), sub(orient(merge(rubber)), 'rubber')];
  },
);

/** Multi-piece propeller shaft: one tube per span, a rubber-mounted centre bearing at every interior point. */
export const propshaft = def(
  z
    .object({
      points: z.array(zV3).min(2),
      r: z.number().default(36),
    })
    .strict(),
  (p) => {
    const pts = p.points.map((q) => v3(q as V3));
    const steel: THREE.BufferGeometry[] = [];
    const rubber: THREE.BufferGeometry[] = [];
    const tubeSeg = (s: THREE.Vector3, e: THREE.Vector3, r: number) => {
      const L = s.distanceTo(e);
      const g = merge([
        cylinder(r, Math.max(10, L - 120), 32, 2).translate(0, L / 2, 0),
        lathe([[0, 0], [r + 18, 0], [r + 18, 36], [r, 60], [0, 60]], 28),
        lathe([[0, L - 60], [r, L - 60], [r + 18, L - 36], [r + 18, L], [0, L]], 28),
      ]);
      return between(g, s, e);
    };
    for (let i = 0; i < pts.length - 1; i++) steel.push(tubeSeg(pts[i], pts[i + 1], p.r * (1 - 0.06 * i)));
    for (let i = 1; i < pts.length - 1; i++) {
      const m = pts[i];
      const dir = pts[i + 1].clone().sub(pts[i - 1]).normalize();
      rubber.push(between(cylinder(48, 40, 32, 3), m.clone().addScaledVector(dir, -20), m.clone().addScaledVector(dir, 20)));
      steel.push(roundedBox([160, 40, 24], 4).translate(m.x, m.y, m.z + 52));
    }
    return [sub(merge(steel), 'steel-black'), sub(merge(rubber), 'rubber')];
  },
);

/** Rack-and-pinion steering gear along local Y with gaiters and a pinion housing. */
export const steeringRack = def(
  z
    .object({
      halfLen: z.number().default(330),
      r: z.number().default(24),
      pinionAt: z.number().default(-180),
      pinionTilt: zV3.default([30, 0, 0]),
    })
    .strict(),
  (p) => {
    const housing = alignY(cylinder(p.r, p.halfLen * 2 - 260, 24, 3), 'y');
    const pinion = cylinder(32, 110, 24, 3).translate(0, 55, 0);
    pinion.rotateX((p.pinionTilt[0] * Math.PI) / 180).translate(-10, p.pinionAt, 10);
    const boss = sphere(46, [1, 1.1, 1]).translate(0, p.pinionAt, 0);
    const clamps = [-1, 1].map((s) => roundedBox([60, 34, 70], 6).translate(-30, s * (p.halfLen - 220), 0));
    const gaiters = [-1, 1].map((s) => {
      const g = bellows(p.r + 2, 14, 140, 7);
      // gaiters run from the housing ends (±(halfLen − 130)) out to the tie-rod joints
      if (s > 0) g.translate(0, p.halfLen - 135, 0);
      else g.rotateZ(Math.PI).translate(0, -(p.halfLen - 135), 0);
      return g;
    });
    return [sub(merge([housing, pinion, boss, ...clamps]), 'aluminium-cast'), sub(merge(gaiters), 'rubber')];
  },
);

