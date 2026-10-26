/**
 * Geometry helpers for generators. Everything here works in the part's local
 * ISO frame (X forward, Y left, Z up) in millimetres; conversion to the
 * three.js frame happens once, at export.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { z } from 'zod';

export type V3 = [number, number, number];
export interface Sub {
  geo: THREE.BufferGeometry;
  mat: string;
}
export interface GenContext {
  nodeId: string;
  shapes: Record<string, unknown>;
}
export interface GeneratorDef<S extends z.ZodType = z.ZodType> {
  params: S;
  build: (p: z.infer<S>, ctx: GenContext) => Sub[];
}
export function def<S extends z.ZodType>(params: S, build: (p: z.infer<S>, ctx: GenContext) => Sub[]): GeneratorDef<S> {
  return { params, build };
}

export const zV3 = z.tuple([z.number(), z.number(), z.number()]);
export const zAxis = z.enum(['x', 'y', 'z']).default('z');

const DEG = Math.PI / 180;

export function v3(a: V3 | THREE.Vector3): THREE.Vector3 {
  return a instanceof THREE.Vector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]);
}

/** Applies translate/rotate(deg, XYZ)/scale to a geometry in place and returns it. */
export function xf(geo: THREE.BufferGeometry, opts: { pos?: V3; rot?: V3; scale?: V3 | number } = {}): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((opts.rot?.[0] ?? 0) * DEG, (opts.rot?.[1] ?? 0) * DEG, (opts.rot?.[2] ?? 0) * DEG, 'XYZ'),
  );
  const s = typeof opts.scale === 'number' ? new THREE.Vector3(opts.scale, opts.scale, opts.scale) : opts.scale ? v3(opts.scale) : new THREE.Vector3(1, 1, 1);
  m.compose(opts.pos ? v3(opts.pos) : new THREE.Vector3(), q, s);
  geo.applyMatrix4(m);
  return geo;
}

/** three.js round primitives are built around +Y; rotate them so their axis is the requested one. */
export function alignY(geo: THREE.BufferGeometry, axis: 'x' | 'y' | 'z'): THREE.BufferGeometry {
  if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  else if (axis === 'z') geo.rotateX(Math.PI / 2);
  return geo;
}

/** Orients a +Y-axis geometry so that its axis runs from `a` to `b`, with its base at `a`. */
export function between(geo: THREE.BufferGeometry, a: V3 | THREE.Vector3, b: V3 | THREE.Vector3): THREE.BufferGeometry {
  const A = v3(a);
  const B = v3(b);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyQuaternion(q);
  geo.translate(A.x, A.y, A.z);
  return geo;
}

export function crease(geo: THREE.BufferGeometry, angleDeg = 35): THREE.BufferGeometry {
  return toCreasedNormals(geo, angleDeg * DEG);
}

export function sub(geo: THREE.BufferGeometry, mat: string): Sub {
  return { geo, mat };
}

// ---------------------------------------------------------------- primitives

export function roundedBox(size: V3, radius = 0, segments = 2): THREE.BufferGeometry {
  const [x, y, z] = size;
  const r = Math.min(radius, Math.min(x, y, z) / 2 - 0.01);
  if (r <= 0.05) return new THREE.BoxGeometry(x, y, z);
  return new RoundedBoxGeometry(x, y, z, segments, r);
}

/** Lathe around +Y from (radius, height) pairs; sharp profile corners are kept crisp. */
export function lathe(profile: [number, number][], segments = 32, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const pts = profile.map(([r, h]) => new THREE.Vector2(Math.max(0, r), h));
  return crease(new THREE.LatheGeometry(pts, segments, phiStart, phiLength), 40);
}

/** Cylinder along +Y, optionally chamfered, centred on the origin. */
export function cylinder(r: number, h: number, segments = 32, chamfer = 0, r2 = r): THREE.BufferGeometry {
  if (chamfer <= 0) return new THREE.CylinderGeometry(r2, r, h, segments, 1, false);
  const c = Math.min(chamfer, r * 0.4, h * 0.4);
  return lathe(
    [
      [0, -h / 2],
      [r - c, -h / 2],
      [r, -h / 2 + c],
      [r2, h / 2 - c],
      [r2 - c, h / 2],
      [0, h / 2],
    ],
    segments,
  );
}

export function sphere(r: number, scale: V3 = [1, 1, 1], w = 24, h = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h).scale(scale[0], scale[1], scale[2]);
}

export function torus(R: number, r: number, radial = 12, tubular = 48, arc = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.TorusGeometry(R, r, radial, tubular, arc);
}

/** Smooth tube through points with closed end caps. */
export function tube(points: V3[], r: number, opts: { radial?: number; closed?: boolean; tension?: number; caps?: boolean } = {}): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => v3(p)), opts.closed ?? false, 'catmullrom', opts.tension ?? 0.35);
  const len = curve.getLength();
  const tubular = Math.max(6, Math.min(400, Math.round(len / Math.max(6, r * 2.2))));
  const radial = opts.radial ?? (r < 6 ? 6 : r < 20 ? 10 : 16);
  const body = new THREE.TubeGeometry(curve, tubular, r, radial, opts.closed ?? false);
  if (opts.closed || opts.caps === false) return body;
  const parts = [stripUv(body)];
  for (const t of [0, 1]) {
    const cap = new THREE.CircleGeometry(r, radial);
    const tangent = curve.getTangentAt(t).normalize();
    if (t === 0) tangent.negate();
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent));
    const p = curve.getPointAt(t);
    cap.translate(p.x, p.y, p.z);
    parts.push(stripUv(cap));
  }
  return merge(parts);
}

/** Extruded 2D outline. `plane` names the two local axes the outline lives in; extrusion runs along the third, centred. */
export function prism(
  outline: [number, number][],
  thickness: number,
  plane: 'xy' | 'xz' | 'yz' = 'xz',
  bevel = 0,
  holes: [number, number][][] = [],
): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(a, b))));
  const b = Math.min(bevel, thickness / 2.5);
  const depth = Math.max(0.1, thickness - 2 * b);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: b > 0 ? 2 : 0,
    curveSegments: 12,
  });
  geo.translate(0, 0, -depth / 2);
  // shape space: (a, b) in XY, extrusion along +Z → remap to the requested plane
  if (plane === 'xz') geo.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  else if (plane === 'yz') geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  return crease(geo, 40);
}

/** Annular sector in the XZ plane (angles measured from +X towards +Z, degrees) extruded along Y between y0 and y1. */
export function arcBox(rIn: number, rOut: number, a0: number, a1: number, y0: number, y1: number, bevel = 0): THREE.BufferGeometry {
  const steps = Math.max(4, Math.round(Math.abs(a1 - a0) / 4));
  const outline: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + ((a1 - a0) * i) / steps) * DEG;
    outline.push([Math.cos(a) * rOut, Math.sin(a) * rOut]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = (a0 + ((a1 - a0) * i) / steps) * DEG;
    outline.push([Math.cos(a) * rIn, Math.sin(a) * rIn]);
  }
  const g = prism(outline, Math.abs(y1 - y0), 'xz', bevel);
  // prism 'xz' maps outline b → +Z and extrudes along Y (centred)
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** Rectangular beam between two points (width along `up`×dir, height along `up`). */
export function beam(a: V3, b: V3, w: number, h: number, radius = 0): THREE.BufferGeometry {
  const A = v3(a);
  const B = v3(b);
  const len = A.distanceTo(B);
  const g = roundedBox([w, len, h], radius);
  g.translate(0, len / 2, 0);
  const dir = B.clone().sub(A).normalize();
  // keep the beam's height axis as close to world Z as possible
  const up = Math.abs(dir.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const side = new THREE.Vector3().crossVectors(dir, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(side, dir).normalize();
  const basis = new THREE.Matrix4().makeBasis(side, dir, realUp);
  g.applyMatrix4(basis);
  g.translate(A.x, A.y, A.z);
  return g;
}

export function stripUv(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  geo.morphAttributes = {};
  return geo;
}

/** Merges geometries regardless of index state; result is indexed. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => {
    const s = stripUv(g.index ? g.toNonIndexed() : g);
    if (!s.attributes.normal) s.computeVertexNormals();
    return s;
  });
  const merged = flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
  if (!merged) throw new Error('mergeGeometries failed (attribute mismatch)');
  return mergeVertices(merged, 1e-4);
}

/** Combines subs that share a material into a single geometry each. */
export function mergeByMaterial(subs: Sub[]): Sub[] {
  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const s of subs) {
    if (!groups.has(s.mat)) groups.set(s.mat, []);
    groups.get(s.mat)!.push(s.geo);
  }
  return [...groups].map(([mat, geos]) => ({ mat, geo: merge(geos) }));
}

/** Reflect across the local XZ plane (left part → right part); winding is fixed so normals stay outward. */
export function mirrorY(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.scale(1, -1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, nor]) {
      if (!attr) continue;
      for (let c = 0; c < 3; c++) {
        const t = attr.getComponent(i + 1, c);
        attr.setComponent(i + 1, c, attr.getComponent(i + 2, c));
        attr.setComponent(i + 2, c, t);
      }
    }
  }
  if (nor) {
    // scale(1,-1,1) already negated normal.y via the normal matrix; nothing else to do
    nor.needsUpdate = true;
  }
  return mergeVertices(g, 1e-4);
}
