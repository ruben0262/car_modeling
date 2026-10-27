/**
 * Wheel-corner generators. Local frame for all of them: origin at the wheel
 * centre, +Y = outboard (authored for the left side; the right side is
 * mirrored), X forward, Z up. Rotation axis is Y.
 */
import * as THREE from 'three';
import { z } from 'zod';
import { alignY, arcBox, beam, crease, cylinder, def, lathe, merge, prism, roundedBox, sphere, sub, type Sub, type V3 } from './util';

const IN = 25.4;

export const tyre = def(
  z.object({ width: z.number(), aspect: z.number(), rim: z.number(), grooves: z.number().int().min(0).max(6).default(4) }).strict(),
  (p) => {
    const W = p.width;
    const H = (p.width * p.aspect) / 100;
    const Rb = (p.rim * IN) / 2;
    const Ro = Rb + H;
    const hw = W / 2;
    const tw = hw * 0.86;
    const bw = hw * 0.8;
    // tread band with circumferential grooves (y from −tw to +tw at r = Ro)
    const tread: [number, number][] = [];
    const gN = p.grooves;
    const gW = 9;
    const gD = 7;
    const centres = Array.from({ length: gN }, (_, i) => -tw + ((i + 1) * (2 * tw)) / (gN + 1));
    tread.push([Ro - 1, -tw]);
    for (const c of centres) {
      tread.push([Ro, c - gW / 2 - 0.5], [Ro - gD, c - gW / 2], [Ro - gD, c + gW / 2], [Ro, c + gW / 2 + 0.5]);
    }
    tread.push([Ro - 1, tw]);
    const sideLo = (s: number): [number, number][] => [
      [Rb - 2, s * bw],
      [Rb + 10, s * (bw + 5)],
      [Rb + H * 0.3, s * (hw - 3)],
      [Rb + H * 0.55, s * hw],
      [Rb + H * 0.8, s * (hw - 3)],
      [Ro - 12, s * (tw + 7)],
      [Ro - 4, s * (tw + 2)],
    ];
    // CCW in (r, y): −y sidewall outward, tread upward, +y sidewall back inward
    const profile = [...sideLo(-1), ...tread, ...sideLo(1).reverse()];
    return [sub(lathe(profile, 96), 'rubber')];
  },
);

export const rim = def(
  z
    .object({
      diameter: z.number(),
      width: z.number(),
      offset: z.number().default(45),
      spokes: z.number().int().min(3).max(12).default(5),
      twin: z.boolean().default(true),
      studs: z.number().int().default(5),
      pcd: z.number().default(108),
      /** Depth of the drop centre below the bead seat, mm (steel wheels are shallower). */
      well: z.number().default(24),
      /** Cast alloy wheel with spokes, or pressed steel wheel with vent holes. */
      style: z.enum(['alloy', 'steel']).default('alloy'),
    })
    .strict(),
  (p) => {
    const Rb = (p.diameter * IN) / 2;
    const W = p.width * IN;
    const t = 5;
    const outer: [number, number][] = [
      [Rb + 17, -W / 2 - 6],
      [Rb + 2, -W / 2],
      [Rb, -W / 2 + 18],
      [Rb - p.well, -W / 2 + 42],
      [Rb - p.well, W / 2 - 75],
      [Rb, W / 2 - 42],
      [Rb, W / 2 - 16],
      [Rb + 2, W / 2],
      [Rb + 17, W / 2 + 6],
    ];
    const inner = outer.map(([r, y]): [number, number] => [r - t, y]).reverse();
    inner[0] = [Rb + 11, W / 2 + 9];
    inner[inner.length - 1] = [Rb + 11, -W / 2 - 9];
    const barrel = lathe([...outer, ...inner, outer[0]], 96);

    const face = p.offset; // mounting face position (outboard of rim centreline)
    const parts: THREE.BufferGeometry[] = [barrel];
    if (p.style === 'steel') {
      // pressed disc welded into the barrel: flat hub face, a raised ring, vent holes in the dish
      parts.push(
        alignY(
          lathe(
            [
              [32, face - 3],
              [74, face - 3],
              [80, face + 3],
              [118, face + 9],
              [150, face + 9],
              [Rb - 6, face + 1],
              [Rb - 6, face + 4],
              [150, face + 12],
              [118, face + 12],
              [80, face + 6],
              [74, face],
              [32, face],
            ],
            64,
          ),
          'y',
        ),
      );
      const holes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < p.spokes; i++) {
        const a = (i / p.spokes) * Math.PI * 2;
        holes.push(roundedBox([30, 2, 20], 6).translate(134, face + 12.4, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(a)));
      }
      const subs: Sub[] = [sub(merge(parts), 'wheel-steel'), sub(merge(holes), 'trim-black')];
      const bolts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < p.studs; i++) {
        const a = (i / p.studs) * Math.PI * 2 + Math.PI / p.studs;
        bolts.push(alignY(cylinder(10.5, 16, 6, 1.5), 'y').translate(Math.cos(a) * (p.pcd / 2), face + 8, Math.sin(a) * (p.pcd / 2)));
      }
      subs.push(sub(merge(bolts), 'steel-zinc'));
      return subs;
    }
    // centre disc
    parts.push(
      alignY(
        lathe(
          [
            [32, face],
            [92, face],
            [96, face + 8],
            [88, face + 20],
            [36, face + 20],
            [32, face + 14],
          ],
          48,
        ),
        'y',
      ),
    );
    // spokes: tapered, dished outward towards the rim lip
    const n = p.twin ? p.spokes * 2 : p.spokes;
    const lipY = W / 2 - 4;
    for (let i = 0; i < n; i++) {
      const base = (360 / p.spokes) * Math.floor(p.twin ? i / 2 : i);
      const split = p.twin ? (i % 2 === 0 ? -7 : 7) : 0;
      const ang = base + split;
      const len = Rb - 30 - 88;
      const outline: [number, number][] = [
        [88, -15],
        [88 + len, -11],
        [88 + len + 8, 0],
        [88 + len, 11],
        [88, 15],
      ];
      const spoke = prism(outline, 20, 'xz', 3);
      // dish: tilt the spoke so its outer end sits further outboard
      const dish = Math.atan2(lipY - (face + 18), len) * (180 / Math.PI);
      spoke.translate(-88, 0, 0);
      spoke.applyMatrix4(new THREE.Matrix4().makeRotationZ((dish * Math.PI) / 180));
      spoke.translate(88, 0, 0);
      spoke.translate(0, face + 16, 0);
      spoke.applyMatrix4(new THREE.Matrix4().makeRotationY((ang * Math.PI) / 180));
      parts.push(spoke);
    }
    const subs: Sub[] = [sub(merge(parts), 'aluminium-machined')];
    // wheel bolts and centre cap
    const bolts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.studs; i++) {
      const a = (i / p.studs) * Math.PI * 2 + Math.PI / p.studs;
      const g = alignY(cylinder(10.5, 22, 6, 1.5), 'y');
      g.translate(Math.cos(a) * (p.pcd / 2), face + 30, Math.sin(a) * (p.pcd / 2));
      bolts.push(g);
    }
    subs.push(sub(merge(bolts), 'steel-zinc'));
    subs.push(sub(alignY(cylinder(30, 8, 32, 2.5), 'y').translate(0, face + 24, 0), 'trim-satin'));
    return subs;
  },
);

const zDisc = {
  d: z.number(),
  t: z.number(),
  y: z.number().default(0),
};

export const brakeDisc = def(
  z
    .object({
      ...zDisc,
      vented: z.boolean().default(true),
      hatDepth: z.number().default(42),
      hatR: z.number().default(84),
      ring: z.number().default(56),
      studs: z.number().int().default(5),
      pcd: z.number().default(108),
    })
    .strict(),
  (p) => {
    const R = p.d / 2;
    const rIn = R - p.ring;
    const y0 = p.y - p.t / 2;
    const y1 = p.y + p.t / 2;
    const parts: THREE.BufferGeometry[] = [];
    if (p.vented) {
      const plate = Math.max(6, p.t * 0.32);
      parts.push(lathe([[rIn, y0], [R, y0], [R, y0 + plate], [rIn, y0 + plate], [rIn, y0]], 96));
      parts.push(lathe([[rIn, y1 - plate], [R, y1 - plate], [R, y1], [rIn, y1], [rIn, y1 - plate]], 96));
      const vanes = 36;
      for (let i = 0; i < vanes; i++) {
        const a = (i / vanes) * Math.PI * 2;
        const g = roundedBox([R - rIn - 6, p.t - 2 * plate + 0.6, 4.5], 0);
        g.translate((R + rIn) / 2, p.y, 0);
        g.rotateY(a);
        parts.push(g);
      }
    } else {
      parts.push(lathe([[rIn, y0], [R - 1, y0], [R, y0 + 1], [R, y1 - 1], [R - 1, y1], [rIn, y1], [rIn, y0]], 96));
    }
    // hat: inner edge of the outboard face up to the mounting face
    const hy = y1 + p.hatDepth;
    parts.push(
      lathe(
        [
          [rIn + 2, y1 - 2],
          [p.hatR + 4, y1 - 2],
          [p.hatR + 4, hy],
          [33, hy],
          [33, hy - 6],
          [p.hatR - 2, hy - 6],
          [p.hatR - 2, y1 - 2],
        ],
        64,
      ),
    );
    return [sub(merge(parts), 'brake-disc')];
  },
);

/** Shared caliper layout so every sub-component lines up with the others. */
const zCaliper = z
  .object({
    ...zDisc,
    /** Angle of the caliper centre around the disc, degrees from +X (forward) towards +Z (up). */
    at: z.number().default(180),
    span: z.number().default(62),
    piston: z.number().default(54),
    /** How far the caliper bridge reaches beyond the disc edge, mm (small wheels leave little room). */
    reach: z.number().default(29),
    part: z.enum(['assembly', 'housing', 'carrier', 'piston', 'pad-inner', 'pad-outer', 'bleed-nipple', 'slide-pins']).default('assembly'),
  })
  .strict();

export const caliper = def(zCaliper, (p) => {
  const R = p.d / 2;
  const a0 = p.at - p.span / 2;
  const a1 = p.at + p.span / 2;
  const padT = 15;
  const inFace = p.y - p.t / 2 - padT - 0.6; // inboard pad back face
  const outFace = p.y + p.t / 2 + padT + 0.6;
  const bodyDepth = 44;
  const rad = (a: number) => (a * Math.PI) / 180;
  const pcR = R - 28; // pad centre radius
  const at = (r: number, a: number, y: number): V3 => [Math.cos(rad(a)) * r, y, Math.sin(rad(a)) * r];

  const housing = (): Sub[] => {
    const g: THREE.BufferGeometry[] = [];
    g.push(arcBox(R - 60, R + 5, a0, a1, inFace - bodyDepth, inFace, 4));
    g.push(arcBox(R + 9, R + p.reach, a0 + 5, a1 - 5, inFace - bodyDepth, outFace + 15, 4));
    g.push(arcBox(R - 46, R + 5, a0 + 8, a1 - 8, outFace, outFace + 15, 3));
    const boss = alignY(cylinder(p.piston / 2 + 9, 22, 40, 3), 'y');
    const c = at(pcR, p.at, inFace - bodyDepth - 6);
    boss.translate(c[0], c[1], c[2]);
    g.push(boss);
    return [sub(merge(g), 'caliper')];
  };
  const carrier = (): Sub[] => {
    const g: THREE.BufferGeometry[] = [];
    g.push(arcBox(R - 66, R + 4, a0 - 16, a1 + 16, inFace - 16, inFace - 4, 2));
    for (const a of [a0 - 12, a1 + 12]) g.push(arcBox(R + 6, R + 18, a - 5, a + 5, inFace - 16, outFace + 2, 2));
    // mounting lugs towards the knuckle
    for (const a of [a0 - 10, a1 + 10]) {
      const lug = alignY(cylinder(11, 26, 16, 1.5), 'y');
      const c = at(R - 78, a, inFace - 20);
      lug.translate(c[0], c[1], c[2]);
      g.push(lug);
    }
    return [sub(merge(g), 'steel-zinc')];
  };
  const pad = (inner: boolean): Sub[] => {
    const face = inner ? inFace : outFace;
    const s = inner ? 1 : -1;
    const backing = arcBox(R - 54, R - 2, a0 + 4, a1 - 4, face, face + s * 5, 1);
    const friction = arcBox(R - 51, R - 4, a0 + 6, a1 - 6, face + s * 5, face + s * padT, 1.5);
    return [sub(backing, 'steel-black'), sub(friction, 'plastic-grey')];
  };
  const piston = (): Sub[] => {
    const c = at(pcR, p.at, 0);
    const g = alignY(lathe([[0, -26], [p.piston / 2 - 1, -26], [p.piston / 2, -25], [p.piston / 2, 0], [p.piston / 2 - 4, 0], [p.piston / 2 - 4, -6], [0, -6]], 40), 'y');
    g.translate(c[0], inFace - 1, c[2]);
    return [sub(g, 'steel-zinc')];
  };
  const nipple = (): Sub[] => {
    const c = at(R - 8, a1 - 10, inFace - bodyDepth);
    const g = merge([alignY(cylinder(5, 16, 6), 'z').translate(0, 0, 8), alignY(cylinder(3, 14, 10), 'z').translate(0, 0, 20)]);
    const dir = new THREE.Vector3(Math.cos(rad(a1 - 10)) * 0.35, -1, Math.sin(rad(a1 - 10)) * 0.35).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
    g.translate(c[0], c[1], c[2]);
    return [sub(g, 'steel-zinc')];
  };
  const pins = (): Sub[] => {
    const metal: THREE.BufferGeometry[] = [];
    const boots: THREE.BufferGeometry[] = [];
    for (const a of [a0 - 12, a1 + 12]) {
      const c = at(R - 28, a, inFace - 30);
      metal.push(alignY(cylinder(8, 26, 6), 'y').translate(c[0], c[1] - 10, c[2]));
      boots.push(alignY(cylinder(9.5, 18, 16, 2), 'y').translate(c[0], c[1] + 10, c[2]));
    }
    return [sub(merge(metal), 'steel-zinc'), sub(merge(boots), 'rubber')];
  };

  switch (p.part) {
    case 'housing':
      return housing();
    case 'carrier':
      return carrier();
    case 'piston':
      return piston();
    case 'pad-inner':
      return pad(true);
    case 'pad-outer':
      return pad(false);
    case 'bleed-nipple':
      return nipple();
    case 'slide-pins':
      return pins();
    default:
      return [...housing(), ...carrier(), ...nipple(), ...pins()];
  }
});

/** Hub with wheel studs plus the bearing cartridge. */
export const hub = def(
  z.object({ face: z.number().default(45), studs: z.number().int().default(5), pcd: z.number().default(108) }).strict(),
  (p) => {
    const flange = lathe(
      [
        [0, p.face - 20],
        [70, p.face - 20],
        [72, p.face - 17],
        [72, p.face - 7],
        [38, p.face - 7],
        [36, p.face - 3],
        [0, p.face - 3],
      ],
      48,
    );
    const shaft = alignY(cylinder(36, 60, 32, 2), 'y').translate(0, p.face - 50, 0);
    const studs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.studs; i++) {
      const a = (i / p.studs) * Math.PI * 2 + Math.PI / p.studs;
      studs.push(alignY(cylinder(6, 34, 8), 'y').translate(Math.cos(a) * (p.pcd / 2), p.face + 8, Math.sin(a) * (p.pcd / 2)));
    }
    return studs.length ? [sub(merge([flange, shaft]), 'steel-zinc'), sub(merge(studs), 'steel-zinc')] : [sub(merge([flange, shaft]), 'steel-zinc')];
  },
);

/** Cast hub carrier / knuckle: bearing boss plus arms to the given attachment points. */
export const knuckle = def(
  z
    .object({
      boss: z.object({ y: z.number(), r: z.number().default(52), len: z.number().default(56) }).strict(),
      arms: z.array(z.object({ to: z.tuple([z.number(), z.number(), z.number()]), w: z.number().default(34), h: z.number().default(26), eye: z.number().default(0) }).strict()),
    })
    .strict(),
  (p) => {
    const g: THREE.BufferGeometry[] = [];
    g.push(alignY(cylinder(p.boss.r, p.boss.len, 40, 4), 'y').translate(0, p.boss.y, 0));
    for (const a of p.arms) {
      const from: V3 = [0, p.boss.y, 0];
      g.push(crease(beam(from, a.to, a.w, a.h, 6)));
      if (a.eye > 0) g.push(sphere(a.eye).translate(a.to[0], a.to[1], a.to[2]));
    }
    return [sub(merge(g), 'iron-cast')];
  },
);

/** Wheel-speed sensor body (sensor head, mounting ear and tail). */
export const wheelSpeedSensor = def(
  z.object({ len: z.number().default(48) }).strict(),
  (p) => {
    const body = alignY(cylinder(9, p.len, 20, 1.5), 'y');
    const ear = roundedBox([30, 6, 16], 2).translate(14, p.len / 2 - 8, 0);
    return [sub(merge([body, ear]), 'plastic-black')];
  },
);

