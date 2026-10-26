/**
 * Runs generators for every node and computes local/world transforms and
 * bounds, all in the ISO vehicle frame (mm).
 */
import * as THREE from 'three';
import { isMaterialId } from '../../src/shared/materials';
import { GENERATORS } from '../geometry/registry';
import { mergeByMaterial, mirrorY, type Sub } from '../geometry/util';
import { DataError, type LoadedVehicle, type ResolvedNode } from './load';

export interface BuiltNode {
  node: ResolvedNode;
  local: THREE.Matrix4;
  world: THREE.Matrix4;
  subs: Sub[];
  /** Key shared by nodes whose geometry is identical (enables mesh reuse in the GLB). */
  geoKey?: string;
  ownBox?: THREE.Box3; // local frame
  worldBox?: THREE.Box3; // own geometry, world frame
  subtreeBox?: THREE.Box3; // node + descendants, world frame
  triangles: number;
}

const DEG = Math.PI / 180;

export function localMatrix(n: ResolvedNode): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(n.rot[0] * DEG, n.rot[1] * DEG, n.rot[2] * DEG, 'XYZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(...n.pos), q, new THREE.Vector3(1, 1, 1));
}

function triCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

export function assemble(v: LoadedVehicle): Map<string, BuiltNode> {
  const problems: string[] = [];
  const built = new Map<string, BuiltNode>();
  const cache = new Map<string, Sub[]>();

  for (const id of v.order) {
    const node = v.nodes.get(id)!;
    const local = localMatrix(node);
    const parentWorld = node.parent ? built.get(node.parent)!.world : new THREE.Matrix4();
    const world = parentWorld.clone().multiply(local);
    const b: BuiltNode = { node, local, world, subs: [], triangles: 0 };
    built.set(id, b);

    const call = node.input?.geometry;
    if (!call) continue;
    const { gen, ...params } = call as { gen: string } & Record<string, unknown>;
    const g = GENERATORS[gen];
    if (!g) {
      problems.push(`${node.file}: "${node.baseId}" uses unknown generator "${gen}"`);
      continue;
    }
    const key = JSON.stringify([call, node.material ?? null, node.mirrored]);
    let subs = cache.get(key);
    if (!subs) {
      const parsed = g.params.safeParse(params);
      if (!parsed.success) {
        problems.push(...parsed.error.issues.map((i) => `${node.file}: "${node.baseId}" geometry ${gen}.${i.path.join('.')}: ${i.message}`));
        continue;
      }
      let raw: Sub[];
      try {
        raw = g.build(parsed.data, { nodeId: id, shapes: v.vehicle.shapes });
      } catch (e) {
        problems.push(`${node.file}: "${node.baseId}" generator ${gen} failed: ${(e as Error).message}`);
        continue;
      }
      const withMat = raw.map((s) => ({ geo: s.geo, mat: s.mat || node.material || '' }));
      for (const s of withMat) {
        if (!s.mat) problems.push(`${node.file}: "${node.baseId}" has geometry without a material (set "material")`);
        else if (!isMaterialId(s.mat)) problems.push(`${node.file}: "${node.baseId}" uses unknown material "${s.mat}"`);
      }
      subs = mergeByMaterial(withMat).map((s) => ({ mat: s.mat, geo: node.mirrored ? mirrorY(s.geo) : s.geo }));
      for (const s of subs) {
        s.geo.computeBoundingBox();
        const bad = (s.geo.attributes.position.array as Float32Array).some((x) => !Number.isFinite(x));
        if (bad) problems.push(`${node.file}: "${node.baseId}" generated non-finite vertices`);
      }
      cache.set(key, subs);
    }
    b.subs = subs;
    b.geoKey = key;
    b.triangles = subs.reduce((n, s) => n + triCount(s.geo), 0);
    const box = new THREE.Box3();
    for (const s of subs) box.union(s.geo.boundingBox!);
    b.ownBox = box;
    b.worldBox = box.clone().applyMatrix4(world);
  }
  if (problems.length) throw new DataError(problems);

  // subtree bounds, children before parents
  for (const id of [...v.order].reverse()) {
    const b = built.get(id)!;
    const box = b.worldBox ? b.worldBox.clone() : new THREE.Box3();
    for (const c of b.node.children) {
      const cb = built.get(c)!.subtreeBox;
      if (cb && !cb.isEmpty()) box.union(cb);
    }
    b.subtreeBox = box;
  }
  return built;
}
