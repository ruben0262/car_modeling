/** Generic generators usable directly from YAML. */
import { z } from 'zod';
import {
  alignY,
  beam,
  crease,
  cylinder,
  def,
  lathe,
  mergeByMaterial,
  prism,
  roundedBox,
  sphere,
  sub,
  torus,
  tube,
  xf,
  zAxis,
  zV3,
  type GeneratorDef,
  type Sub,
} from './util';

const pose = { pos: zV3.optional(), rot: zV3.optional() };

export const box = def(
  z.object({ size: zV3, r: z.number().nonnegative().default(0), mat: z.string().optional(), ...pose }).strict(),
  (p) => [sub(xf(roundedBox(p.size, p.r), p), p.mat ?? '')],
);

export const cyl = def(
  z
    .object({
      r: z.number().positive(),
      r2: z.number().positive().optional(),
      h: z.number().positive(),
      axis: zAxis,
      seg: z.number().int().min(6).max(128).default(32),
      chamfer: z.number().nonnegative().default(0),
      mat: z.string().optional(),
      ...pose,
    })
    .strict(),
  (p) => [sub(xf(alignY(cylinder(p.r, p.h, p.seg, p.chamfer, p.r2 ?? p.r), p.axis), p), p.mat ?? '')],
);

export const latheGen = def(
  z
    .object({
      profile: z.array(z.tuple([z.number(), z.number()])).min(2),
      axis: zAxis,
      seg: z.number().int().min(6).max(128).default(40),
      mat: z.string().optional(),
      ...pose,
    })
    .strict(),
  (p) => [sub(xf(alignY(lathe(p.profile, p.seg), p.axis), p), p.mat ?? '')],
);

export const tubeGen = def(
  z
    .object({
      points: z.array(zV3).min(2),
      r: z.number().positive(),
      closed: z.boolean().default(false),
      tension: z.number().min(0).max(1).default(0.35),
      mat: z.string().optional(),
    })
    .strict(),
  (p) => [sub(tube(p.points, p.r, { closed: p.closed, tension: p.tension }), p.mat ?? '')],
);

export const prismGen = def(
  z
    .object({
      outline: z.array(z.tuple([z.number(), z.number()])).min(3),
      holes: z.array(z.array(z.tuple([z.number(), z.number()])).min(3)).default([]),
      thickness: z.number().positive(),
      plane: z.enum(['xy', 'xz', 'yz']).default('xz'),
      bevel: z.number().nonnegative().default(0),
      mat: z.string().optional(),
      ...pose,
    })
    .strict(),
  (p) => [sub(xf(prism(p.outline, p.thickness, p.plane, p.bevel, p.holes), p), p.mat ?? '')],
);

export const sphereGen = def(
  z.object({ r: z.number().positive(), scale: zV3.default([1, 1, 1]), mat: z.string().optional(), ...pose }).strict(),
  (p) => [sub(xf(sphere(p.r, p.scale), p), p.mat ?? '')],
);

export const torusGen = def(
  z
    .object({
      R: z.number().positive(),
      r: z.number().positive(),
      arc: z.number().positive().max(360).default(360),
      axis: zAxis,
      mat: z.string().optional(),
      ...pose,
    })
    .strict(),
  // TorusGeometry lies in XY with its axis on Z
  (p) => {
    const g = torus(p.R, p.r, 12, 64, (p.arc * Math.PI) / 180);
    if (p.axis === 'x') g.rotateY(Math.PI / 2);
    else if (p.axis === 'y') g.rotateX(Math.PI / 2);
    return [sub(xf(g, p), p.mat ?? '')];
  },
);

/** Welded frame of rectangular beams (subframes, brackets, crossmembers). */
export const frame = def(
  z
    .object({
      beams: z.array(z.object({ a: zV3, b: zV3, w: z.number().positive(), h: z.number().positive() }).strict()).min(1),
      r: z.number().nonnegative().default(4),
      nodes: z.array(z.object({ at: zV3, size: z.number().positive() }).strict()).default([]),
      mat: z.string().optional(),
    })
    .strict(),
  (p) => [
    ...p.beams.map((b) => sub(crease(beam(b.a, b.b, b.w, b.h, p.r)), p.mat ?? '')),
    ...p.nodes.map((n) => sub(xf(roundedBox([n.size, n.size, n.size], n.size * 0.2), { pos: n.at }), p.mat ?? '')),
  ],
);

/**
 * Composition of other generators, each with its own pose and material.
 * Used for one-off shapes that are not worth a dedicated generator.
 */
export function makeCompound(registry: Record<string, GeneratorDef>) {
  return def(
    z
      .object({
        parts: z.array(z.looseObject({ gen: z.string(), pos: zV3.optional(), rot: zV3.optional(), mat: z.string().optional() })).min(1),
      })
      .strict(),
    (p, ctx) => {
      const out: Sub[] = [];
      for (const part of p.parts) {
        const g = registry[part.gen];
        if (!g) throw new Error(`compound: unknown generator "${part.gen}"`);
        const { gen: _gen, pos, rot, mat, ...rest } = part;
        // pose is applied here, after the child generator, so every generator supports it uniformly
        const parsed = g.params.parse(rest);
        for (const s of g.build(parsed, ctx)) out.push({ geo: xf(s.geo, { pos, rot }), mat: (mat as string | undefined) ?? s.mat });
      }
      return mergeByMaterial(out);
    },
  );
}
