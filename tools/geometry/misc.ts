/** Electrical, cooling, fuel/exhaust and interior generators. */
import * as THREE from 'three';
import { z } from 'zod';
import { alignY, beam, crease, cylinder, def, lathe, merge, prism, roundedBox, sphere, sub, torus, tube, zV3, type Sub, type V3 } from './util';

/** 12 V lead-acid battery; size is [length (X), width (Y), height (Z)], origin at the base centre. */
export const battery = def(
  z.object({ size: zV3, part: z.enum(['assembly', 'case', 'terminals']).default('assembly') }).strict(),
  (p) => {
    const [L, W, H] = p.size as V3;
    const caseG = merge([
      roundedBox([L, W, H - 12], 6).translate(0, 0, (H - 12) / 2),
      roundedBox([L - 6, W - 6, 14], 4).translate(0, 0, H - 8),
      roundedBox([L * 0.5, 16, 8], 3).translate(0, 0, H),
    ]);
    const posT = alignY(cylinder(9, 18, 20, 1.5, 8), 'z').translate(L / 2 - 30, -W / 2 + 26, H + 8);
    const negT = alignY(cylinder(8, 18, 20, 1.5, 7), 'z').translate(-L / 2 + 30, -W / 2 + 26, H + 8);
    const cap = alignY(cylinder(16, 12, 24, 3), 'z').translate(L / 2 - 30, -W / 2 + 26, H + 4);
    const out: Sub[] = [];
    if (p.part !== 'terminals') out.push(sub(caseG, 'battery-case'), sub(roundedBox([L * 0.3, 2, H * 0.25], 1).translate(0, -W / 2 - 0.5, H * 0.6), 'label-yellow'));
    if (p.part !== 'case') out.push(sub(merge([posT, negT]), 'terminal-lead'), sub(cap, 'cable-red'));
    return out;
  },
);

/** Fuse/relay box or control module housing with lid and connector sockets on one face. */
export const enclosure = def(
  z
    .object({
      size: zV3,
      lid: z.boolean().default(true),
      fins: z.boolean().default(false),
      sockets: z.number().int().min(0).max(8).default(0),
      socketFace: z.enum(['x+', 'x-', 'y+', 'y-', 'z-']).default('x+'),
      mat: z.string().default('plastic-black'),
    })
    .strict(),
  (p) => {
    const [x, y, zz] = p.size as V3;
    const g: THREE.BufferGeometry[] = [roundedBox([x, y, zz * (p.lid ? 0.72 : 1)], Math.min(6, zz / 4)).translate(0, 0, (-zz * (p.lid ? 0.28 : 0)) / 2)];
    if (p.lid) g.push(roundedBox([x + 6, y + 6, zz * 0.3], Math.min(8, zz / 5)).translate(0, 0, zz * 0.36));
    const fins: THREE.BufferGeometry[] = [];
    if (p.fins) for (let i = 0; i < 9; i++) fins.push(roundedBox([3, y * 0.8, 8], 1).translate(-x / 2 + 12 + (i * (x - 24)) / 8, 0, zz / 2 + 4));
    const sockets: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.sockets; i++) {
      const u = -0.5 + (i + 0.5) / p.sockets;
      const s = roundedBox([22, 0.8 * (p.socketFace.startsWith('y') ? x : y) / p.sockets - 6, zz * 0.5], 3);
      if (p.socketFace === 'x+') s.translate(x / 2 + 9, u * y, 0);
      else if (p.socketFace === 'x-') s.translate(-x / 2 - 9, u * y, 0);
      else if (p.socketFace === 'z-') s.rotateY(Math.PI / 2).translate(u * x, 0, -zz / 2 - 9);
      else {
        s.rotateZ(Math.PI / 2);
        s.translate(u * x, (p.socketFace === 'y+' ? 1 : -1) * (y / 2 + 9), 0);
      }
      sockets.push(s);
    }
    const out: Sub[] = [sub(merge(g), p.mat)];
    if (fins.length) out.push(sub(merge(fins), 'aluminium-cast'));
    if (sockets.length) out.push(sub(merge(sockets), 'connector-grey'));
    return out;
  },
);

/** Wiring connector body with latch, local +X = mating direction. */
export const connector = def(
  z.object({ size: zV3.default([28, 22, 16]), mat: z.string().default('connector-black'), wireR: z.number().default(0) }).strict(),
  (p) => {
    const [x, y, zz] = p.size as V3;
    const body = roundedBox([x, y, zz], Math.min(3, zz / 4));
    const latch = roundedBox([x * 0.5, y * 0.35, 3], 1).translate(-x * 0.05, 0, zz / 2 + 1.5);
    const rib = roundedBox([2, y + 2, zz + 2], 0.5).translate(-x * 0.3, 0, 0);
    const out: Sub[] = [sub(merge([body, latch, rib]), p.mat)];
    if (p.wireR > 0) out.push(sub(alignY(cylinder(p.wireR, 20, 10), 'x').translate(-x / 2 - 10, 0, 0), 'harness-black'));
    return out;
  },
);

/** Heat-exchanger: finned core between two end tanks. Core lies in the local YZ plane, thickness along X. */
export const heatExchanger = def(
  z
    .object({
      core: zV3,
      tanks: z.enum(['sides', 'top-bottom']).default('sides'),
      tank: z.number().default(50),
      ports: z.array(z.object({ at: zV3, dir: zV3, r: z.number(), len: z.number().default(40) }).strict()).default([]),
      tankMat: z.string().default('plastic-black'),
      coreMat: z.string().default('radiator-core'),
    })
    .strict(),
  (p) => {
    const [cx, cy, cz] = p.core as V3;
    const core = roundedBox([cx, cy, cz], 2);
    const fins: THREE.BufferGeometry[] = [];
    const n = Math.round(cz / 18);
    for (let i = 0; i <= n; i++) fins.push(roundedBox([cx + 1.5, cy - 4, 1.6], 0).translate(0, 0, -cz / 2 + (i * cz) / n));
    const tanks: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      if (p.tanks === 'sides') tanks.push(roundedBox([cx + 14, p.tank, cz + 20], 8).translate(0, s * (cy / 2 + p.tank / 2), 0));
      else tanks.push(roundedBox([cx + 14, cy + 20, p.tank], 8).translate(0, 0, s * (cz / 2 + p.tank / 2)));
    }
    for (const port of p.ports) {
      const dir = new THREE.Vector3(...(port.dir as V3)).normalize();
      const g = cylinder(port.r, port.len, 20).translate(0, port.len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      g.translate(port.at[0], port.at[1], port.at[2]);
      tanks.push(g);
    }
    return [sub(merge([core, ...fins]), p.coreMat), sub(merge(tanks), p.tankMat)];
  },
);

/** Electric cooling fan in a shroud; airflow along local X. */
export const fan = def(
  z.object({ size: z.tuple([z.number(), z.number()]), r: z.number(), blades: z.number().int().default(7), depth: z.number().default(60) }).strict(),
  (p) => {
    const [w, h] = p.size;
    const hole: [number, number][] = [];
    for (let i = 0; i < 64; i++) {
      const a = (-i / 64) * Math.PI * 2;
      hole.push([Math.cos(a) * (p.r + 6), Math.sin(a) * (p.r + 6)]);
    }
    const plate = prism(
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ],
      8,
      'yz',
      2,
      [hole],
    );
    const ring = alignY(cylinder(p.r + 10, p.depth * 0.6, 64), 'x');
    const ringIn = alignY(cylinder(p.r + 7, p.depth * 0.6 + 1, 64), 'x');
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.blades; i++) {
      const b = roundedBox([4, p.r * 0.62, p.r * 0.32], 2).translate(0, p.r * 0.52, 0);
      b.rotateY(0.45);
      b.rotateX((i / p.blades) * Math.PI * 2);
      blades.push(b);
    }
    const hub = alignY(cylinder(p.r * 0.24, p.depth * 0.5, 32, 4), 'x');
    const motor = alignY(cylinder(p.r * 0.3, p.depth * 0.8, 32, 6), 'x').translate(-p.depth * 0.6, 0, 0);
    const struts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      struts.push(crease(beam([-p.depth * 0.6, 0, 0], [-p.depth * 0.3, Math.cos(a) * (p.r + 8), Math.sin(a) * (p.r + 8)], 10, 6, 2)));
    }
    return [sub(merge([plate, ring, ...struts]), 'plastic-black'), sub(merge([...blades, hub]), 'plastic-grey'), sub(merge([motor, ringIn]), 'steel-black')];
  },
);

/** Cylindrical canister (DPF, catalyst, silencer, filter) along local X, with optional cone ends and stubs. */
export const canister = def(
  z
    .object({
      len: z.number(),
      r: z.number(),
      oval: z.number().default(1),
      cones: z.number().default(0),
      stubR: z.number().default(0),
      stubLen: z.number().default(40),
      mat: z.string().default('exhaust-steel'),
      shield: z.boolean().default(false),
    })
    .strict(),
  (p) => {
    const half = p.len / 2;
    const prof: [number, number][] = [[0, -half - p.cones]];
    if (p.cones > 0) prof.push([p.stubR || p.r * 0.4, -half - p.cones], [p.r, -half]);
    else prof.push([p.r - 4, -half], [p.r, -half + 4]);
    if (p.cones > 0) prof.push([p.r, half], [p.stubR || p.r * 0.4, half + p.cones]);
    else prof.push([p.r, half - 4], [p.r - 4, half]);
    prof.push([0, half + (p.cones > 0 ? p.cones : 0)]);
    const body = alignY(lathe(prof, 48), 'x');
    body.scale(1, 1, p.oval);
    const g = [body];
    if (p.stubR > 0)
      for (const s of [-1, 1]) g.push(alignY(cylinder(p.stubR, p.stubLen, 24), 'x').translate(s * (half + p.cones + p.stubLen / 2 - 2), 0, 0));
    const out: Sub[] = [sub(merge(g), p.mat)];
    if (p.shield) out.push(sub(roundedBox([p.len * 0.9, p.r * 2.2, 3], 1).translate(0, 0, p.r * p.oval + 10), 'heatshield'));
    return out;
  },
);

/** Saddle fuel tank: two lobes joined by a bridge over the transmission tunnel. Origin at the tank centre. */
export const saddleTank = def(
  z
    .object({
      len: z.number(),
      lobeW: z.number(),
      gap: z.number(),
      h: z.number(),
      bridgeH: z.number().default(60),
    })
    .strict(),
  (p) => {
    const g: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) g.push(roundedBox([p.len, p.lobeW, p.h], 30, 3).translate(0, s * (p.gap / 2 + p.lobeW / 2), 0));
    g.push(roundedBox([p.len * 0.8, p.gap + 80, p.bridgeH], 20, 3).translate(0, 0, p.h / 2 - p.bridgeH / 2));
    const straps: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) straps.push(roundedBox([30, p.gap + p.lobeW * 2 + 20, 4], 1).translate(s * p.len * 0.3, 0, -p.h / 2 - 3));
    return [sub(merge(g), 'plastic-black'), sub(merge(straps), 'steel-black')];
  },
);

/** Seat (cushion, backrest, head restraint) facing +X; origin at the seat base centre on the floor. */
export const seat = def(
  z.object({ width: z.number().default(520), bench: z.boolean().default(false), recline: z.number().default(18), heights: zV3.default([300, 140, 640]) }).strict(),
  (p) => {
    const [baseH, cushT, backH] = p.heights as V3;
    const w = p.width;
    const fabric: THREE.BufferGeometry[] = [];
    fabric.push(roundedBox([500, w, cushT], 45, 4).translate(30, 0, baseH + cushT / 2));
    const back = roundedBox([120, w, backH], 50, 4).translate(0, 0, backH / 2);
    back.rotateY((-p.recline * Math.PI) / 180);
    back.translate(-200, 0, baseH + cushT - 10);
    fabric.push(back);
    const heads = p.bench ? [-w / 3, 0, w / 3] : [0];
    const tilt = (-p.recline * Math.PI) / 180;
    for (const hy of heads) {
      const hr = roundedBox([90, p.bench ? 220 : 260, 170], 40, 3).translate(0, hy, 0);
      hr.translate(-200 - Math.sin(-tilt) * (backH + 110), 0, baseH + cushT + Math.cos(tilt) * (backH + 100));
      fabric.push(hr);
    }
    const frame: THREE.BufferGeometry[] = [];
    if (!p.bench) for (const s of [-1, 1]) frame.push(roundedBox([460, 30, 40], 6).translate(20, s * (w / 2 - 50), baseH / 2), roundedBox([520, 24, 18], 4).translate(20, s * (w / 2 - 50), 9));
    const out: Sub[] = [sub(merge(fabric), 'interior-fabric')];
    if (frame.length) out.push(sub(merge(frame), 'steel-black'));
    return out;
  },
);

/** Steering wheel in the local YZ plane (column along −X), origin at the hub. */
export const steeringWheel = def(
  z.object({ r: z.number().default(185), grip: z.number().default(16) }).strict(),
  (p) => {
    const rim = torus(p.r, p.grip, 14, 72);
    rim.rotateY(Math.PI / 2);
    const hub = roundedBox([60, 170, 140], 28, 4).translate(10, 0, 0);
    const spokes = [
      [0, -1],
      [0, 1],
      [-1, 0],
    ].map(([zz, y]) => crease(beam([0, y * 60, zz * 55], [-6, y * (p.r - 6), zz * (p.r - 6)], 40, 16, 6)));
    return [sub(merge([rim]), 'interior-dark'), sub(merge([hub, ...spokes]), 'interior-trim')];
  },
);

/** Lamp unit: housing with a lens face pointing along local +X. */
export const lamp = def(
  z.object({ size: zV3, lens: z.string().default('lens-clear'), reflectors: z.number().int().default(2) }).strict(),
  (p) => {
    const [x, y, zz] = p.size as V3;
    const housing = roundedBox([x * 0.8, y, zz], Math.min(18, zz / 3)).translate(-x * 0.1, 0, 0);
    const lens = roundedBox([x * 0.25, y - 6, zz - 6], Math.min(16, zz / 3)).translate(x * 0.38, 0, 0);
    const refl: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.reflectors; i++) {
      const u = -0.5 + (i + 0.5) / p.reflectors;
      refl.push(alignY(lathe([[0, 0], [zz * 0.32, 0], [zz * 0.36, 10], [0, 12]], 32), 'x').translate(x * 0.28, u * (y - 40), 0));
    }
    return [sub(merge([housing]), 'trim-black'), sub(merge(refl), 'chrome'), sub(lens, p.lens)];
  },
);

/** Door mirror: housing on a stalk; local +Y = outboard. */
export const mirror = def(z.object({}).strict(), () => {
  const housing = sphere(1, [85, 115, 62], 32, 20).translate(-30, 150, 10);
  const glass = roundedBox([4, 190, 100], 10).translate(-84, 150, 10);
  const stalk = crease(beam([0, 0, -20], [-10, 80, 0], 60, 26, 8));
  return [sub(merge([housing]), 'paint'), sub(merge([stalk]), 'trim-black'), sub(glass, 'chrome')];
});

/** Air cleaner housing with lid and snorkel; local +X forward. */
export const airbox = def(
  z.object({ size: zV3, snorkel: z.array(zV3).default([]), outlet: z.array(zV3).default([]) }).strict(),
  (p) => {
    const [x, y, zz] = p.size as V3;
    const lower = roundedBox([x, y, zz * 0.62], 14).translate(0, 0, -zz * 0.19);
    const lid = roundedBox([x + 6, y + 6, zz * 0.4], 16).translate(0, 0, zz * 0.3);
    const clips: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) clips.push(roundedBox([14, 10, 30], 3).translate(s * x * 0.3, y / 2 + 5, zz * 0.1));
    const pipes: THREE.BufferGeometry[] = [];
    if (p.snorkel.length >= 2) pipes.push(tube(p.snorkel as V3[], 38));
    if (p.outlet.length >= 2) pipes.push(tube(p.outlet as V3[], 36));
    const out: Sub[] = [sub(merge([lower, lid, ...clips]), 'plastic-black')];
    if (pipes.length) out.push(sub(merge(pipes), 'rubber'));
    return out;
  },
);

/** Pedal (arm and pad) hinged at the origin, pad below/behind it. */
export const pedal = def(
  z.object({ len: z.number().default(260), pad: z.tuple([z.number(), z.number()]).default([70, 60]) }).strict(),
  (p) => {
    const arm = crease(beam([0, 0, 0], [80, 0, -p.len], 18, 10, 3));
    const pad = roundedBox([12, p.pad[0], p.pad[1]], 4).translate(86, 0, -p.len - 10);
    return [sub(merge([arm]), 'steel-black'), sub(merge([pad]), 'rubber')];
  },
);

