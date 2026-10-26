/**
 * Engine and transmission generators. Engine-local frame: origin on the
 * crankshaft axis at the flywheel face; +X along the crank towards the
 * timing end, +Y towards the intake side, +Z up (cylinder axis).
 */
import * as THREE from 'three';
import { z } from 'zod';
import { alignY, crease, cylinder, def, lathe, merge, prism, roundedBox, sphere, sub, tube, xf, zV3, type Sub, type V3 } from './util';

const R2 = z.tuple([z.number(), z.number()]);

export const engineBlock = def(
  z
    .object({
      len: z.number(),
      y: R2,
      z: R2,
      bores: z.array(z.number()).default([]),
      boreR: z.number().default(50),
    })
    .strict(),
  (p) => {
    const [y0, y1] = p.y;
    const [z0, z1] = p.z;
    const g: THREE.BufferGeometry[] = [];
    g.push(roundedBox([p.len, y1 - y0 - 40, z1 - z0], 12).translate(p.len / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    // skirt widens towards the bottom
    g.push(roundedBox([p.len - 10, y1 - y0, (z1 - z0) * 0.45], 10).translate(p.len / 2, (y0 + y1) / 2, z0 + (z1 - z0) * 0.22));
    // cylinder barrels on the intake face
    for (const x of p.bores) g.push(alignY(cylinder(p.boreR, (z1 - z0) * 0.55, 28, 4), 'z').translate(x, y1 - 26, z1 - (z1 - z0) * 0.3));
    // stiffening ribs on the exhaust face
    for (let i = 1; i < 6; i++) g.push(roundedBox([10, 12, (z1 - z0) * 0.6], 3).translate((p.len * i) / 6, y0 + 4, z0 + (z1 - z0) * 0.45));
    g.push(roundedBox([p.len - 40, 12, 14], 3).translate(p.len / 2, y0 + 4, z1 - 40));
    return [sub(merge(g), 'iron-cast')];
  },
);

export const oilSump = def(
  z.object({ x: R2, y: R2, z: R2, ladder: z.number().default(55), plug: R2.optional() }).strict(),
  (p) => {
    const [x0, x1] = p.x;
    const [y0, y1] = p.y;
    const [z0, z1] = p.z;
    const ladder = roundedBox([x1 - x0, y1 - y0, p.ladder], 8).translate((x0 + x1) / 2, (y0 + y1) / 2, z1 - p.ladder / 2);
    const outline: [number, number][] = [
      [y0 + 8, z1 - p.ladder],
      [y1 - 8, z1 - p.ladder],
      [y1 - 30, z0 + 20],
      [y1 - 60, z0],
      [y0 + 60, z0],
      [y0 + 30, z0 + 20],
    ];
    const pan = prism(outline, x1 - x0 - 30, 'yz', 8).translate((x0 + x1) / 2, 0, 0);
    const [px, py] = p.plug ?? [(x0 + x1) / 2 + 60, y0 + 90];
    const plug = alignY(cylinder(11, 16, 6), 'z').translate(px, py, z0 - 6);
    return [sub(merge([ladder]), 'aluminium-cast'), sub(merge([pan, plug]), 'steel-black')];
  },
);

export const cylinderHead = def(
  z.object({ len: z.number(), y: R2, z: R2, ports: z.array(z.number()).default([]) }).strict(),
  (p) => {
    const [y0, y1] = p.y;
    const [z0, z1] = p.z;
    const g: THREE.BufferGeometry[] = [roundedBox([p.len, y1 - y0, z1 - z0], 10).translate(p.len / 2, (y0 + y1) / 2, (z0 + z1) / 2)];
    for (const x of p.ports) {
      g.push(roundedBox([58, 26, 44], 8).translate(x, y1 + 8, (z0 + z1) / 2));
      g.push(roundedBox([52, 26, 40], 8).translate(x, y0 - 8, (z0 + z1) / 2 + 4));
    }
    return [sub(merge(g), 'aluminium-cast')];
  },
);

export const camCover = def(
  z.object({ len: z.number(), y: R2, z: R2, injectors: z.array(z.number()).default([]), filler: z.number().optional(), injectorY: z.number().default(0) }).strict(),
  (p) => {
    const [y0, y1] = p.y;
    const [z0, z1] = p.z;
    const h = z1 - z0;
    const g: THREE.BufferGeometry[] = [roundedBox([p.len, y1 - y0, h], Math.min(22, h / 2.2), 4).translate(p.len / 2, (y0 + y1) / 2, (z0 + z1) / 2)];
    for (const s of [-1, 1]) g.push(roundedBox([p.len - 60, 10, 8], 3).translate(p.len / 2, (y0 + y1) / 2 + s * (y1 - y0) * 0.3, z1 + 2));
    const rub: THREE.BufferGeometry[] = p.injectors.map((x) => alignY(cylinder(20, 8, 24, 2), 'z').translate(x, p.injectorY, z1 + 1));
    const out: Sub[] = [sub(merge(g), 'aluminium-cast')];
    if (rub.length) out.push(sub(merge(rub), 'rubber'));
    if (p.filler !== undefined) out.push(sub(alignY(cylinder(30, 22, 32, 3), 'z').translate(p.filler, (y0 + y1) / 2 - 30, z1 + 9), 'plastic-black'));
    return out;
  },
);

/** Moulded acoustic engine cover with raised centre spine. */
export const engineCover = def(
  z.object({ x: R2, y: R2, z: R2 }).strict(),
  (p) => {
    const [x0, x1] = p.x;
    const [y0, y1] = p.y;
    const [z0, z1] = p.z;
    const h = z1 - z0;
    const base = roundedBox([x1 - x0, y1 - y0, h * 0.7], h * 0.3, 4).translate((x0 + x1) / 2, (y0 + y1) / 2, z0 + h * 0.35);
    const spine = roundedBox([(x1 - x0) * 0.62, (y1 - y0) * 0.42, h * 0.5], h * 0.22, 4).translate((x0 + x1) / 2 + 10, (y0 + y1) / 2, z1 - h * 0.25);
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) ribs.push(roundedBox([(x1 - x0) * 0.12, 8, 6], 2).translate(x0 + (x1 - x0) * (0.15 + i * 0.05), y0 + 30, z0 + h * 0.72));
    return [sub(merge([base, spine]), 'plastic-black'), sub(merge(ribs), 'trim-satin')];
  },
);

/** Pulley with poly-V grooves; axis along local X. */
export function pulleyGeo(r: number, w: number, ribs = 6): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0, -w / 2],
    [r - 6, -w / 2],
    [r, -w / 2 + 2],
  ];
  // poly-V ribs; a smooth (idler/tensioner) pulley has ribs = 0
  const n = Math.max(1, ribs);
  for (let i = 0; i <= n; i++) {
    const y = -w / 2 + 3 + ((w - 6) * i) / n;
    prof.push([r - (ribs > 0 && i % 2 ? 3 : 0), y]);
  }
  prof.push([r, w / 2 - 2], [r - 6, w / 2], [r * 0.45, w / 2], [r * 0.45, w / 2 + 6], [0, w / 2 + 6]);
  return alignY(lathe(prof, 48), 'x');
}

export const pulley = def(
  z.object({ r: z.number(), w: z.number().default(26), ribs: z.number().int().default(6), mat: z.string().default('steel-black'), ...{ pos: zV3.optional(), rot: zV3.optional() } }).strict(),
  (p) => [sub(xf(pulleyGeo(p.r, p.w, p.ribs), p), p.mat)],
);

function hull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function circlesHull(circles: { y: number; z: number; r: number }[], grow: number): [number, number][] {
  const pts: [number, number][] = [];
  for (const c of circles)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([c.y + Math.cos(a) * (c.r + grow), c.z + Math.sin(a) * (c.r + grow)]);
    }
  return hull(pts);
}

/** Serpentine belt wrapped around pulleys lying in a YZ plane at `x`. */
export const belt = def(
  z.object({ x: z.number(), width: z.number().default(22), thickness: z.number().default(5), pulleys: z.array(z.object({ y: z.number(), z: z.number(), r: z.number() }).strict()).min(2) }).strict(),
  (p) => {
    const outer = circlesHull(p.pulleys, p.thickness);
    const inner = circlesHull(p.pulleys, 0);
    const g = prism(outer, p.width, 'yz', 0, [inner]).translate(p.x, 0, 0);
    return [sub(g, 'rubber')];
  },
);

/** Spiral volute (turbo/pump housing) around local X. */
export function volute(R0: number, r0: number, r1: number, sweep = 330, outletLen = 60, x0 = 0): THREE.BufferGeometry {
  const nT = 72;
  const nP = 20;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nT; i++) {
    const th = ((sweep * i) / nT) * (Math.PI / 180);
    const r = r0 + ((r1 - r0) * i) / nT;
    const Rc = R0 + r;
    const u = [0, Math.cos(th), Math.sin(th)];
    for (let j = 0; j <= nP; j++) {
      const ph = (j / nP) * Math.PI * 2;
      pos.push(x0 + Math.sin(ph) * r, u[1] * (Rc + Math.cos(ph) * r), u[2] * (Rc + Math.cos(ph) * r));
    }
  }
  for (let i = 0; i < nT; i++)
    for (let j = 0; j < nP; j++) {
      const a = i * (nP + 1) + j;
      const b = a + nP + 1;
      // dθ × dφ points away from the spiral centreline (outward normals)
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // tangential outlet at the end of the spiral
  const th = sweep * (Math.PI / 180);
  const Rc = R0 + r1;
  const start = new THREE.Vector3(x0, Math.cos(th) * Rc, Math.sin(th) * Rc);
  const tangent = new THREE.Vector3(0, -Math.sin(th), Math.cos(th));
  const outlet = cylinder(r1, outletLen + 10, 20).translate(0, (outletLen + 10) / 2 - 10, 0);
  outlet.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent));
  outlet.translate(start.x, start.y, start.z);
  return merge([g, outlet]);
}

export const turbo = def(
  z
    .object({
      part: z.enum(['assembly', 'compressor-housing', 'turbine-housing', 'chra', 'actuator']).default('assembly'),
      /** Rotation of the compressor outlet about the shaft axis, degrees. */
      outletAt: z.number().default(0),
      inletAt: z.number().default(180),
    })
    .strict(),
  (p) => {
    const comp = (): Sub[] => {
      const v = volute(46, 11, 30, 320, 70, -58);
      v.rotateX((p.outletAt * Math.PI) / 180);
      const inlet = alignY(lathe([[44, 0], [44, 8], [38, 12], [36, 70], [42, 74], [42, 82], [30, 82], [30, 0]], 40), 'x');
      inlet.rotateZ(Math.PI).translate(-62, 0, 0);
      const back = alignY(cylinder(84, 18, 48, 4), 'x').translate(-34, 0, 0);
      return [sub(merge([v, inlet, back]), 'aluminium-cast')];
    };
    const turb = (): Sub[] => {
      const v = volute(40, 13, 29, 300, 50, 58);
      v.rotateX((p.inletAt * Math.PI) / 180);
      const outlet = alignY(cylinder(42, 58, 36, 3), 'x').translate(98, 0, 0);
      const flange = alignY(cylinder(54, 10, 6, 2), 'x').translate(126, 0, 0);
      return [sub(merge([v, outlet, flange]), 'iron-cast')];
    };
    const chra = (): Sub[] => {
      const body = alignY(lathe([[0, -30], [52, -30], [52, -22], [36, -14], [36, 14], [48, 22], [48, 30], [0, 30]], 40), 'x');
      const feed = tube([[0, 0, 36], [0, 10, 90], [-30, 40, 150]], 4);
      const ret = alignY(cylinder(14, 50, 16), 'z').translate(0, 0, -50);
      return [sub(merge([body]), 'steel-zinc'), sub(merge([feed, ret]), 'steel-black')];
    };
    const actuator = (): Sub[] => {
      const can = alignY(cylinder(34, 48, 32, 4), 'y').translate(-40, 78, 70);
      const bracket = roundedBox([50, 12, 70], 3).translate(-40, 60, 40);
      const rod = tube([[-40, 78, 40], [10, 60, 10], [55, 30, -20]], 3);
      return [sub(merge([can]), 'steel-black'), sub(merge([bracket, rod]), 'steel-zinc')];
    };
    switch (p.part) {
      case 'compressor-housing':
        return comp();
      case 'turbine-housing':
        return turb();
      case 'chra':
        return chra();
      case 'actuator':
        return actuator();
      default:
        return [...comp(), ...turb(), ...chra(), ...actuator()];
    }
  },
);

/** Generic cylindrical machine (pump, alternator, compressor, starter) along local X. */
export const machine = def(
  z
    .object({
      kind: z.enum(['alternator', 'ac-compressor', 'starter', 'pump', 'vacuum-pump']),
      r: z.number(),
      len: z.number(),
      pulleyR: z.number().optional(),
      mat: z.string().optional(),
    })
    .strict(),
  (p) => {
    const g: THREE.BufferGeometry[] = [];
    const extra: Sub[] = [];
    if (p.kind === 'alternator') {
      g.push(alignY(cylinder(p.r, p.len, 40, 6), 'x'));
      for (let i = 0; i < 7; i++) g.push(alignY(cylinder(p.r + 3, 4, 40), 'x').translate(-p.len / 2 + 14 + i * ((p.len - 28) / 6), 0, 0));
      g.push(alignY(cylinder(p.r * 0.7, 30, 32, 3), 'x').translate(-p.len / 2 - 14, 0, 0));
      g.push(roundedBox([30, 34, 28], 4).translate(-p.len / 2 - 10, p.r * 0.4, p.r * 0.75));
    } else if (p.kind === 'ac-compressor') {
      g.push(alignY(cylinder(p.r, p.len, 40, 6), 'x'));
      g.push(roundedBox([p.len * 0.5, p.r * 0.9, 40], 8).translate(-p.len * 0.15, 0, p.r + 10));
      for (const s of [-1, 1]) g.push(alignY(cylinder(16, 40, 16), 'z').translate(-p.len * 0.15 + s * 40, 0, p.r + 40));
    } else if (p.kind === 'starter') {
      g.push(alignY(cylinder(p.r, p.len, 36, 5), 'x'));
      g.push(alignY(cylinder(p.r * 0.55, p.len * 0.7, 28, 4), 'x').translate(p.len * 0.12, 0, p.r * 1.25));
      g.push(alignY(cylinder(p.r * 0.75, 60, 32, 3), 'x').translate(p.len / 2 + 30, 0, 0));
      g.push(alignY(cylinder(p.r * 1.25, 12, 32, 2), 'x').translate(p.len / 2 + 4, 0, 0));
    } else if (p.kind === 'vacuum-pump') {
      g.push(alignY(cylinder(p.r, p.len, 32, 5), 'x'));
      g.push(alignY(cylinder(10, 50, 12), 'z').translate(0, 0, p.r + 20));
    } else {
      g.push(alignY(cylinder(p.r, p.len, 32, 5), 'x'));
      g.push(roundedBox([24, p.r * 2.4, p.r * 2.4], 6).translate(p.len / 2 + 8, 0, 0));
      for (const s of [-1, 1]) g.push(alignY(cylinder(9, 34, 12), 'z').translate(s * p.len * 0.2, 0, p.r + 14));
    }
    if (p.pulleyR) extra.push(sub(pulleyGeo(p.pulleyR, 26).translate(p.len / 2 + 22, 0, 0), 'steel-black'));
    return [sub(merge(g), p.mat ?? (p.kind === 'starter' ? 'steel-black' : 'aluminium-cast')), ...extra];
  },
);

/** Piezo common-rail injector, nozzle down along −Z, connector at the top. */
export const injector = def(
  z.object({ len: z.number().default(150) }).strict(),
  (p) => {
    const body = lathe(
      [
        [0, 0],
        [3.5, 0],
        [4, 8],
        [8.5, 14],
        [8.5, p.len * 0.45],
        [12, p.len * 0.5],
        [12, p.len * 0.92],
        [9, p.len],
        [0, p.len],
      ],
      24,
    );
    alignY(body, 'z');
    const plug = roundedBox([24, 16, 22], 3).translate(4, 0, p.len + 8);
    const leak = alignY(cylinder(4, 18, 8), 'y').translate(0, 10, p.len * 0.85);
    return [sub(merge([body, leak]), 'steel-zinc'), sub(merge([plug]), 'plastic-black')];
  },
);

export const glowPlug = def(
  z.object({ len: z.number().default(100) }).strict(),
  (p) => {
    const g = lathe(
      [
        [0, 0],
        [2.6, 0],
        [2.6, p.len * 0.32],
        [5, p.len * 0.36],
        [5, p.len * 0.62],
        [7.5, p.len * 0.64],
        [7.5, p.len * 0.76],
        [3, p.len * 0.78],
        [3, p.len],
        [0, p.len],
      ],
      6,
    );
    return [sub(alignY(g, 'z'), 'steel-zinc')];
  },
);

/** Gearbox case for a transverse transaxle; input along −X from the bell face at x = 0. */
export const transaxle = def(
  z
    .object({
      len: z.number().default(400),
      bellR: z.number().default(205),
      diff: z.object({ y: z.number(), z: z.number(), r: z.number().default(105) }).strict(),
      caseY: R2.default([-200, 150]),
      caseZ: R2.default([-185, 175]),
    })
    .strict(),
  (p) => {
    const g: THREE.BufferGeometry[] = [];
    const bell = alignY(
      lathe(
        [
          [0, 0],
          [p.bellR, 0],
          [p.bellR, 14],
          [p.bellR - 25, 70],
          [p.bellR - 40, 130],
          [0, 130],
        ],
        48,
      ),
      'x',
    );
    bell.rotateZ(Math.PI);
    g.push(bell);
    const [y0, y1] = p.caseY;
    const [z0, z1] = p.caseZ;
    g.push(roundedBox([p.len - 120, y1 - y0, z1 - z0], 28, 3).translate(-(p.len + 120) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    g.push(alignY(cylinder(p.diff.r, p.len - 70, 40, 8), 'x').translate(-(p.len - 70) / 2 - 20, p.diff.y, p.diff.z));
    for (let i = 0; i < 4; i++) g.push(roundedBox([10, y1 - y0 - 30, 16], 3).translate(-140 - i * 60, (y0 + y1) / 2, z1 - 6));
    const pan = roundedBox([p.len - 160, (y1 - y0) * 0.7, 40], 8).translate(-(p.len + 80) / 2, (y0 + y1) / 2 + 20, z0 - 14);
    return [sub(merge(g), 'aluminium-cast'), sub(merge([pan]), 'steel-black')];
  },
);

/** Bevel-gear housing (PTU / rear drive unit body). Input axis along local −Y, through-axis along X. */
export const bevelHousing = def(
  z
    .object({
      r: z.number().default(95),
      len: z.number().default(210),
      nose: z.number().default(150),
      noseR: z.number().default(55),
      ears: z.boolean().default(true),
    })
    .strict(),
  (p) => {
    const g: THREE.BufferGeometry[] = [];
    g.push(alignY(cylinder(p.r, p.len, 40, 10), 'x'));
    g.push(sphere(p.r * 1.05, [1.05, 1, 0.95]).translate(0, -p.r * 0.2, 0));
    const nose = lathe(
      [
        [0, 0],
        [p.r * 0.85, 0],
        [p.noseR + 10, p.nose * 0.6],
        [p.noseR, p.nose],
        [p.noseR + 14, p.nose],
        [p.noseR + 14, p.nose + 14],
        [0, p.nose + 14],
      ],
      36,
    );
    nose.rotateZ(Math.PI); // point along −Y
    g.push(nose);
    if (p.ears) for (const s of [-1, 1]) g.push(roundedBox([40, 50, 30], 6).translate(s * (p.len / 2 + 10), 30, p.r * 0.6));
    for (const s of [-1, 1]) g.push(alignY(cylinder(38, 30, 32, 3), 'x').translate(s * (p.len / 2 + 15), 0, 0));
    return [sub(merge(g), 'aluminium-cast')];
  },
);

/** Haldex-type active on-demand coupling with its integral ECU and pump (axis along local Y). */
export const coupling = def(
  z.object({ r: z.number().default(82), len: z.number().default(150) }).strict(),
  (p) => {
    const body = alignY(lathe([[0, 0], [p.r * 0.7, 0], [p.r, 18], [p.r, p.len - 20], [p.r * 0.8, p.len], [0, p.len]], 40), 'y');
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) ribs.push(alignY(cylinder(p.r + 3, 5, 40), 'y').translate(0, 30 + i * 18, 0));
    const ecu = roundedBox([110, 70, 40], 6).translate(0, p.len * 0.55, p.r + 14);
    const pump = alignY(cylinder(26, 70, 20, 3), 'x').translate(p.r * 0.6, p.len * 0.3, -p.r * 0.7);
    return [sub(merge([body, ...ribs]), 'aluminium-cast'), sub(merge([ecu]), 'plastic-black'), sub(merge([pump]), 'steel-black')];
  },
);

/** Hydraulic engine mount: rubber block in a cast bracket. */
export const mount = def(
  z.object({ size: zV3.default([90, 80, 70]) }).strict(),
  (p) => {
    const [x, y, zz] = p.size as V3;
    const bracket = crease(roundedBox([x, y, zz * 0.35], 6)).translate(0, 0, zz * 0.32);
    const rubber = alignY(cylinder(Math.min(x, y) * 0.38, zz * 0.6, 28, 6), 'z').translate(0, 0, -zz * 0.12);
    const base = roundedBox([x * 1.2, y * 0.9, zz * 0.18], 4).translate(0, 0, -zz * 0.45);
    return [sub(merge([bracket, base]), 'aluminium-cast'), sub(merge([rubber]), 'rubber')];
  },
);

/**
 * Serpentine belt in the local YZ plane at `x`. Pulleys are listed in belt
 * order; side 1 = the ribbed face wraps the pulley (pulley inside the loop),
 * side -1 = the belt's back runs over it (idler or tensioner outside the loop).
 */
export const serpentine = def(
  z
    .object({
      x: z.number(),
      width: z.number().default(21),
      thickness: z.number().default(4.5),
      pulleys: z.array(z.object({ y: z.number(), z: z.number(), r: z.number(), side: z.union([z.literal(1), z.literal(-1)]).default(1) }).strict()).min(2),
    })
    .strict(),
  (p) => {
    let ps = p.pulleys.map((q) => ({ c: new THREE.Vector2(q.y, q.z), rho: q.side === 1 ? q.r : -(q.r + p.thickness) }));
    // traverse counter-clockwise (shoelace over the wrapped pulleys)
    const area = ps.reduce((a, q, i) => {
      const n = ps[(i + 1) % ps.length];
      return a + (q.c.x * n.c.y - n.c.x * q.c.y);
    }, 0);
    if (area < 0) ps = ps.reverse();
    const n = ps.length;
    const leave: THREE.Vector2[] = [];
    const arrive: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = ps[i];
      const b = ps[(i + 1) % n];
      const D = b.c.clone().sub(a.c);
      const L = D.length();
      const d = D.clone().divideScalar(L);
      const dp = new THREE.Vector2(-d.y, d.x);
      const sinPhi = THREE.MathUtils.clamp((b.rho - a.rho) / L, -1, 1);
      const nL = dp.multiplyScalar(Math.sqrt(1 - sinPhi * sinPhi)).add(d.clone().multiplyScalar(sinPhi));
      leave[i] = a.c.clone().sub(nL.clone().multiplyScalar(a.rho));
      arrive[(i + 1) % n] = b.c.clone().sub(nL.clone().multiplyScalar(b.rho));
    }
    const path: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const { c, rho } = ps[i];
      const t0 = Math.atan2(arrive[i].y - c.y, arrive[i].x - c.x);
      const t1 = Math.atan2(leave[i].y - c.y, leave[i].x - c.x);
      let sweep = t1 - t0;
      if (rho > 0) while (sweep < 0) sweep += Math.PI * 2;
      else while (sweep > 0) sweep -= Math.PI * 2;
      const steps = Math.max(2, Math.ceil((Math.abs(sweep) * Math.abs(rho)) / 6));
      for (let k = 0; k <= steps; k++) {
        const t = t0 + (sweep * k) / steps;
        path.push(new THREE.Vector2(c.x + Math.cos(t) * Math.abs(rho), c.y + Math.sin(t) * Math.abs(rho)));
      }
    }
    // sweep a width × thickness section; the belt body lies outside the ribbed (inner) face
    const pos: number[] = [];
    const idx: number[] = [];
    const m = path.length;
    for (let i = 0; i < m; i++) {
      const prev = path[(i - 1 + m) % m];
      const next = path[(i + 1) % m];
      const t = next.clone().sub(prev).normalize();
      const out = new THREE.Vector2(t.y, -t.x); // right of travel = outside the loop
      const inner = path[i];
      const outer = inner.clone().add(out.multiplyScalar(p.thickness));
      for (const [q, xx] of [
        [inner, p.x - p.width / 2],
        [inner, p.x + p.width / 2],
        [outer, p.x + p.width / 2],
        [outer, p.x - p.width / 2],
      ] as const)
        pos.push(xx, q.x, q.y);
    }
    for (let i = 0; i < m; i++) {
      const a = i * 4;
      const b = ((i + 1) % m) * 4;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return [sub(crease(g, 30), 'rubber')];
  },
);
