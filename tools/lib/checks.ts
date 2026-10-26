/**
 * Automated verification checks. These cannot prove a part is correct, but
 * they catch the mistakes that are easy to make and hard to spot by eye:
 * wrong wheelbase, parts outside the body, parts intersecting other
 * assemblies, connectors that do not meet, harnesses that end nowhere.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CheckResult } from '../../src/shared/manifest';
import { verificationStatus } from '../../src/shared/verification';
import type { EwdData } from '../../src/shared/wiring';
import { merge } from '../geometry/util';
import { relevantEwdComponents } from './emit';
import type { BuiltNode } from './assemble';
import type { LoadedVehicle, ResolvedNode } from './load';

const LINE_KINDS = new Set(['harness', 'hose', 'pipe', 'connector']);

/** Shortest distance between two axis-aligned boxes (0 when they overlap). */
function boxGap(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

export function runChecks(v: LoadedVehicle, built: Map<string, BuiltNode>, ewd?: EwdData): CheckResult[] {
  const out: CheckResult[] = [];
  const env = v.vehicle.envelope;
  const withGeo = [...built.values()].filter((b) => b.subs.length > 0);

  // 1. wheel centres vs published wheelbase / track / ride height
  // road wheels: tyres whose spin axis (local Y) is horizontal — excludes a spare stowed flat
  const tyres = withGeo.filter((b) => {
    if ((b.node.input?.geometry as { gen?: string } | undefined)?.gen !== 'tyre') return false;
    const axis = new THREE.Vector3(0, 1, 0).transformDirection(b.world);
    return Math.abs(axis.z) < 0.5;
  });
  const wheelProblems: string[] = [];
  for (const t of tyres) {
    const c = new THREE.Vector3().setFromMatrixPosition(t.world);
    const front = c.x > -env.wheelbase / 2;
    const expX = front ? 0 : -env.wheelbase;
    const expY = (front ? env.trackFront : env.trackRear) / 2;
    const r = (t.ownBox!.max.z - t.ownBox!.min.z) / 2;
    if (Math.abs(c.x - expX) > 5) wheelProblems.push(`${t.node.id}: centre X ${c.x.toFixed(0)} mm, expected ${expX} (wheelbase ${env.wheelbase})`);
    if (Math.abs(Math.abs(c.y) - expY) > 10) wheelProblems.push(`${t.node.id}: centre |Y| ${Math.abs(c.y).toFixed(0)} mm, expected ${expY} (track/2)`);
    if (Math.abs(c.z - r) > 8) wheelProblems.push(`${t.node.id}: centre Z ${c.z.toFixed(0)} mm but tyre radius ${r.toFixed(0)} — tyre not on the ground`);
  }
  out.push(
    tyres.length !== 4
      ? { id: 'wheels', severity: 'error', title: `Expected 4 road wheels, found ${tyres.length}`, nodes: tyres.map((t) => t.node.id) }
      : wheelProblems.length
        ? { id: 'wheels', severity: 'error', title: 'Wheel positions do not match published wheelbase/track', nodes: tyres.map((t) => t.node.id), detail: wheelProblems.join('\n') }
        : { id: 'wheels', severity: 'info', title: `Wheel centres match wheelbase ${env.wheelbase} mm and tracks ${env.trackFront}/${env.trackRear} mm`, nodes: [] },
  );

  // 2. overall body dimensions
  const bodyParts = withGeo.filter((b) => b.node.system === 'body');
  const bodyBox = new THREE.Box3();
  for (const b of bodyParts) bodyBox.union(b.worldBox!);
  if (!bodyBox.isEmpty()) {
    const extreme = (pick: (b: THREE.Box3) => number, best: (a: number, b: number) => boolean) =>
      bodyParts.reduce((acc, b) => (best(pick(b.worldBox!), pick(acc.worldBox!)) ? b : acc)).node.id;
    const dims: [string, number, number, number, string][] = [
      ['length', bodyBox.max.x - bodyBox.min.x, env.length, 0.01, `front-most ${extreme((b) => b.max.x, (a, b) => a > b)} (x ${bodyBox.max.x.toFixed(0)}), rear-most ${extreme((b) => b.min.x, (a, b) => a < b)} (x ${bodyBox.min.x.toFixed(0)})`],
      // published height is measured from the ground
      ['height', bodyBox.max.z, env.height, 0.012, `highest ${extreme((b) => b.max.z, (a, b) => a > b)}`],
    ];
    const msgs = dims
      .filter(([, got, exp, tol]) => Math.abs(got - exp) > exp * tol)
      .map(([n, got, exp, , why]) => `${n}: model ${got.toFixed(0)} mm vs published ${exp} mm — ${why}`);
    // width is checked without the door mirrors (published width excludes them)
    const noMirrors = new THREE.Box3();
    for (const b of withGeo) if (b.node.system === 'body' && !/mirror/.test(b.node.baseId)) noMirrors.union(b.worldBox!);
    const w = noMirrors.getSize(new THREE.Vector3()).y;
    if (Math.abs(w - env.width) > env.width * 0.012) msgs.push(`width (excl. mirrors): model ${w.toFixed(0)} mm vs published ${env.width} mm`);
    out.push(
      msgs.length
        ? { id: 'dimensions', severity: 'error', title: 'Body extents do not match published dimensions', nodes: [], detail: msgs.join('\n') }
        : { id: 'dimensions', severity: 'info', title: `Body extents match ${env.length} × ${env.width} × ${env.height} mm (L × W × H)`, nodes: [] },
    );
  }

  // 3. everything inside the vehicle envelope (mirrors allowed beyond the published width)
  const envBox = new THREE.Box3(new THREE.Vector3(env.xRear - 40, -1120, -10), new THREE.Vector3(env.xFront + 40, 1120, env.height + 40));
  const outside = withGeo.filter((b) => !envBox.containsBox(b.worldBox!));
  if (outside.length)
    out.push({
      id: 'envelope',
      severity: 'error',
      title: `${outside.length} part(s) extend outside the vehicle envelope`,
      nodes: outside.map((b) => b.node.id),
      detail: outside.map((b) => `${b.node.id}: x ${b.worldBox!.min.x.toFixed(0)}…${b.worldBox!.max.x.toFixed(0)}, |y| ≤ ${Math.max(-b.worldBox!.min.y, b.worldBox!.max.y).toFixed(0)}, z ${b.worldBox!.min.z.toFixed(0)}…${b.worldBox!.max.z.toFixed(0)}`).join('\n'),
    });

  // 4. interference between different assemblies
  const group = (b: BuiltNode): string => {
    let id: string | null = b.node.parent;
    while (id) {
      const n = v.nodes.get(id)!;
      if (n.kind === 'assembly' || n.kind === 'system') return n.id;
      id = n.parent;
    }
    return b.node.system;
  };
  const isAncestor = (a: string, b: string) => {
    let id: string | null = v.nodes.get(b)!.parent;
    while (id) {
      if (id === a) return true;
      id = v.nodes.get(id)!.parent;
    }
    return false;
  };
  // contacts declared on a node or any of its ancestors cover the other node and all of its descendants
  const inContact = (from: string, to: string) => {
    let cur: string | null = from;
    while (cur) {
      const n: ResolvedNode = v.nodes.get(cur)!;
      if (n.contacts.some((c: string) => c === to || isAncestor(c, to))) return true;
      cur = n.parent;
    }
    return false;
  };
  const solid = withGeo.filter((b) => !LINE_KINDS.has(b.node.kind));
  const bvhCache = new Map<string, { bvh: MeshBVH; geo: THREE.BufferGeometry; tris: number }>();
  const bvhOf = (b: BuiltNode) => {
    let e = bvhCache.get(b.node.id);
    if (!e) {
      const geo = merge(b.subs.map((s) => s.geo.clone()));
      const bvh = new MeshBVH(geo);
      // with a boundsTree on both sides three-mesh-bvh intersects tree-against-tree
      geo.boundsTree = bvh;
      e = { geo, bvh, tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 };
      bvhCache.set(b.node.id, e);
    }
    return e;
  };
  const clashes: string[] = [];
  const clashNodes = new Set<string>();
  const shrink = new THREE.Vector3(2, 2, 2);
  for (let i = 0; i < solid.length; i++) {
    const a = solid[i];
    const boxA = a.worldBox!.clone().expandByVector(shrink.clone().negate());
    for (let j = i + 1; j < solid.length; j++) {
      const b = solid[j];
      if (!boxA.intersectsBox(b.worldBox!)) continue;
      if (group(a) === group(b)) continue;
      if (a.node.system === 'body' && (b.node.system === 'body' || b.node.system === 'structure')) continue;
      if (b.node.system === 'body' && a.node.system === 'structure') continue;
      if (inContact(a.node.id, b.node.id) || inContact(b.node.id, a.node.id)) continue;
      if (isAncestor(a.node.id, b.node.id) || isAncestor(b.node.id, a.node.id)) continue;
      let [A, B, wa, wb] = [bvhOf(a), bvhOf(b), a.world, b.world];
      // iterate the smaller mesh against the larger mesh's tree
      if (B.tris > A.tris) [A, B, wa, wb] = [B, A, wb, wa];
      const bToA = wa.clone().invert().multiply(wb);
      if (A.bvh.intersectsGeometry(B.geo, bToA)) {
        clashes.push(`${a.node.id} ↔ ${b.node.id}`);
        clashNodes.add(a.node.id).add(b.node.id);
      }
    }
  }
  out.push(
    clashes.length
      ? {
          id: 'interference',
          severity: 'warning',
          title: `${clashes.length} intersecting part pair(s) between different assemblies`,
          nodes: [...clashNodes],
          detail: clashes.slice(0, 80).join('\n') + (clashes.length > 80 ? `\n… and ${clashes.length - 80} more` : ''),
        }
      : { id: 'interference', severity: 'info', title: 'No intersections between separate assemblies', nodes: [] },
  );

  // 5. connectors that claim to mate must meet, and the relationship must be mutual
  const centre = (b: BuiltNode) => (b.worldBox ? b.worldBox.getCenter(new THREE.Vector3()) : new THREE.Vector3().setFromMatrixPosition(b.world));
  const mateMsgs: string[] = [];
  for (const b of built.values()) {
    const m = b.node.mates;
    if (!m) continue;
    const other = built.get(m)!;
    if (other.node.mates && other.node.mates !== b.node.id) mateMsgs.push(`${b.node.id} → ${m}, but ${m} mates with ${other.node.mates}`);
    const d = boxGap(b.subtreeBox!, other.subtreeBox!);
    if (d > 15) mateMsgs.push(`${b.node.id} and ${m} are ${d.toFixed(0)} mm apart`);
  }
  if (mateMsgs.length) out.push({ id: 'connector-mates', severity: 'warning', title: 'Mating connectors do not meet', nodes: [], detail: mateMsgs.join('\n') });

  // 6. harness routes must pass by every connector/part they claim to connect
  const harnessMsgs: string[] = [];
  const harnessNodes: string[] = [];
  for (const b of built.values()) {
    if (!b.node.connects.length) continue;
    // authored points are for the left copy; the right copy's geometry is mirrored in its local frame
    const pts = ((b.node.input?.geometry as { points?: [number, number, number][] } | undefined)?.points ?? []).map((p) =>
      new THREE.Vector3(p[0], b.node.mirrored ? -p[1] : p[1], p[2]).applyMatrix4(b.world),
    );
    if (!pts.length) continue;
    for (const target of b.node.connects) {
      const t = built.get(target)!;
      const box = t.subtreeBox && !t.subtreeBox.isEmpty() ? t.subtreeBox : null;
      const d = Math.min(...pts.map((p) => (box ? box.distanceToPoint(p) : p.distanceTo(centre(t)))));
      if (d > 120) {
        harnessMsgs.push(`${b.node.id}: route passes ${d.toFixed(0)} mm from ${target}`);
        harnessNodes.push(b.node.id);
      }
    }
  }
  out.push(
    harnessMsgs.length
      ? { id: 'harness-routes', severity: 'warning', title: 'Harness routes that do not reach what they connect', nodes: harnessNodes, detail: harnessMsgs.join('\n') }
      : { id: 'harness-routes', severity: 'info', title: 'Every harness route reaches the parts it connects', nodes: [] },
  );

  // 7. duplicates: the same physical component must exist once
  const dupMsgs: string[] = [];
  const dupNodes = new Set<string>();
  const byCode = new Map<string, string[]>();
  for (const n of v.nodes.values()) for (const c of n.ewd) byCode.set(c, [...(byCode.get(c) ?? []), n.id]);
  for (const [code, ids] of byCode)
    if (ids.length > 1) {
      dupMsgs.push(`EWD component ${code} is mapped to ${ids.join(', ')}`);
      ids.forEach((i) => dupNodes.add(i));
    }
  const byName = new Map<string, string[]>();
  for (const n of v.nodes.values()) {
    if (n.kind === 'system') continue;
    const key = `${n.parent}|${n.name.toLowerCase()}`;
    byName.set(key, [...(byName.get(key) ?? []), n.id]);
  }
  for (const ids of byName.values())
    if (ids.length > 1) {
      dupMsgs.push(`same name under one parent: ${ids.join(', ')}`);
      ids.forEach((i) => dupNodes.add(i));
    }
  // near-identical geometry in the same place (e.g. a part left behind after it was re-authored elsewhere)
  const leaves = withGeo.filter((b) => b.node.children.length === 0);
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++) {
      const A = leaves[i].worldBox!;
      const B = leaves[j].worldBox!;
      if (!A.intersectsBox(B)) continue;
      const inter = A.clone().intersect(B).getSize(new THREE.Vector3());
      const iv = inter.x * inter.y * inter.z;
      const va = A.getSize(new THREE.Vector3());
      const vb = B.getSize(new THREE.Vector3());
      const union = va.x * va.y * va.z + vb.x * vb.y * vb.z - iv;
      if (union > 0 && iv / union > 0.92 && leaves[i].triangles > 0 && Math.abs(leaves[i].triangles - leaves[j].triangles) / leaves[i].triangles < 0.1) {
        dupMsgs.push(`near-identical parts occupy the same space: ${leaves[i].node.id} ↔ ${leaves[j].node.id}`);
        dupNodes.add(leaves[i].node.id).add(leaves[j].node.id);
      }
    }
  out.push(
    dupMsgs.length
      ? { id: 'duplicates', severity: 'error', title: `${dupMsgs.length} duplicated component(s)`, nodes: [...dupNodes], detail: dupMsgs.join('\n') }
      : { id: 'duplicates', severity: 'info', title: 'No duplicated components (wiring codes, names, geometry)', nodes: [] },
  );

  // 8. wiring-diagram cross-reference
  if (ewd) {
    const badConnectors = [...v.nodes.values()].filter((n) => n.input?.connector?.ewd && !ewd.connectors[n.input.connector.ewd]);
    if (badConnectors.length)
      out.push({ id: 'ewd-connectors', severity: 'error', title: `${badConnectors.length} connector id(s) not found in the wiring diagrams`, nodes: badConnectors.map((n) => n.id), detail: badConnectors.map((n) => `${n.id}: ${n.input!.connector!.ewd}`).join('\n') });
    const unknown = [...byCode.keys()].filter((c) => !ewd.components[c]);
    if (unknown.length)
      out.push({ id: 'ewd-codes', severity: 'error', title: `${unknown.length} EWD code(s) not found in the wiring diagrams`, nodes: unknown.flatMap((c) => byCode.get(c)!), detail: unknown.join(', ') });
    const naCodes = (v.vehicle.wiring?.notApplicable ?? []).flatMap((n) => n.codes);
    const naProblems = [
      ...naCodes.filter((c) => !ewd.components[c]).map((c) => `${c} is listed as not applicable but is not in the wiring diagrams`),
      ...naCodes.filter((c) => byCode.has(c)).map((c) => `${c} is listed as not applicable but is mapped to ${byCode.get(c)!.join(', ')}`),
    ];
    if (naProblems.length) out.push({ id: 'ewd-not-applicable', severity: 'error', title: 'Contradictory not-applicable wiring codes', nodes: [], detail: naProblems.join('\n') });
    const relevant = relevantEwdComponents(ewd, new Set(naCodes));
    const missing = [...relevant].filter((c) => !byCode.has(c)).sort();
    out.push({
      id: 'ewd-coverage',
      severity: 'info',
      title: `Wiring diagrams: ${relevant.size - missing.length} of ${relevant.size} electrical components have a 3D part (${naCodes.length} not applicable to this variant)`,
      nodes: [],
      detail: missing.length ? `Not yet modelled:\n${missing.map((c) => `${c} ${ewd.components[c].name}`).join('\n')}` : undefined,
    });
  }

  // 9. verification coverage summary
  const counts = { verified: 0, partial: 0, unverified: 0 };
  for (const n of v.nodes.values()) if (n.kind !== 'system') counts[verificationStatus(n.verification)]++;
  out.push({
    id: 'coverage',
    severity: 'info',
    title: `Verification: ${counts.verified} verified · ${counts.partial} partially verified · ${counts.unverified} unverified`,
    nodes: [],
  });
  const unsourced = [...v.nodes.values()].filter((n) => n.kind !== 'system' && n.verification.sources.length === 0);
  if (unsourced.length)
    out.push({ id: 'unsourced', severity: 'info', title: `${unsourced.length} component(s) cite no source yet`, nodes: unsourced.map((n) => n.id) });

  return out;
}
