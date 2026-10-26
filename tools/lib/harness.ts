/**
 * Harness synthesis: physically connects every electrical part to the harness
 * network and lays the wiring-diagram netlist out on it.
 *
 * 1. The authored harness trunks (kind `harness`, routed `tube` geometry) form
 *    a routing graph in the vehicle frame (mm). A trunk end that stops near
 *    another trunk is spliced into it; an island left over is joined to the
 *    main network at its closest vertex (an *estimated* junction, reported).
 * 2. Every part carrying wiring-diagram codes gets its connectors: a part an
 *    authored harness already reaches is anchored there; any other part gets
 *    a generated branch from the nearest trunk point, ending in one housing
 *    per connector id the netlist prints for it.
 * 3. Splices, in-line connector pairs and ground points are placed where the
 *    wires they join meet on the graph (graph median), because the diagrams
 *    print their connections but not their positions.
 *
 * Generated nodes carry `generated: true` and estimated placement. The graph
 * ships inside the wiring file so the viewer can draw any wire along the
 * harnesses (src/app/wiring.ts).
 */
import * as THREE from 'three';
import { MM_TO_M, type Vec3 } from '../../src/shared/frames';
import type { CheckResult } from '../../src/shared/manifest';
import { splitPin, type EwdData, type EwdWire, type WiringLayout } from '../../src/shared/wiring';
import { merge, roundedBox, type Sub } from '../geometry/util';
import type { BuiltNode } from './assemble';
import { relevantEwdComponents } from './emit';
import type { LoadedVehicle, ResolvedNode } from './load';
import type { NodeInputT } from './schema';

/** Longest graph segment (mm). */
const STEP = 40;
/** A trunk end this close to another trunk is spliced into it (mm). */
const JOIN = 260;
/** An authored harness passing this close to a part already reaches it (mm). */
const REACH = 60;
/** Routing penalty on estimated junctions, so wires prefer real harness runs. */
const VIRTUAL = 1.6;
const HOUSING_MATS = ['connector-black', 'connector-grey', 'connector-black', 'connector-green', 'connector-blue'];

type V3 = THREE.Vector3;

class MinHeap {
  private k: number[] = [];
  private d: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, dist: number) {
    const { k, d } = this;
    k.push(key);
    d.push(dist);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p] <= d[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, d } = this;
    const top: [number, number] = [k[0], d[0]];
    const lk = k.pop()!;
    const ld = d.pop()!;
    if (k.length) {
      k[0] = lk;
      d[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && d[l] < d[m]) m = l;
        if (r < k.length && d[r] < d[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [d[m], d[i]] = [d[i], d[m]];
        i = m;
      }
    }
    return top;
  }
}

class Graph {
  pos: V3[] = [];
  owner: string[] = [];
  adj: { to: number; w: number }[][] = [];
  edges: { a: number; b: number; virtual: boolean }[] = [];

  add(p: V3, owner: string): number {
    this.pos.push(p.clone());
    this.owner.push(owner);
    this.adj.push([]);
    return this.pos.length - 1;
  }

  link(a: number, b: number, virtual = false) {
    if (a === b) return;
    const w = this.pos[a].distanceTo(this.pos[b]) * (virtual ? VIRTUAL : 1);
    this.adj[a].push({ to: b, w });
    this.adj[b].push({ to: a, w });
    this.edges.push({ a, b, virtual });
  }

  /** Adds a polyline resampled to STEP; returns its vertex indices (first = `start` when given). */
  polyline(points: V3[], owner: string, start?: number): number[] {
    let prev = start ?? this.add(points[0], owner);
    const idx = [prev];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / STEP));
      for (let k = 1; k <= n; k++) {
        const v = this.add(a.clone().lerp(b, k / n), owner);
        this.link(prev, v);
        idx.push(v);
        prev = v;
      }
    }
    return idx;
  }

  dijkstra(sources: number[]): { dist: Float64Array; prev: Int32Array } {
    const dist = new Float64Array(this.pos.length).fill(Infinity);
    const prev = new Int32Array(this.pos.length).fill(-1);
    const heap = new MinHeap();
    for (const s of sources) {
      dist[s] = 0;
      heap.push(s, 0);
    }
    while (heap.size) {
      const [u, du] = heap.pop();
      if (du > dist[u]) continue;
      for (const { to, w } of this.adj[u]) {
        const nd = du + w;
        if (nd < dist[to]) {
          dist[to] = nd;
          prev[to] = u;
          heap.push(to, nd);
        }
      }
    }
    return { dist, prev };
  }

  components(): Int32Array {
    const comp = new Int32Array(this.pos.length).fill(-1);
    let c = 0;
    for (let s = 0; s < comp.length; s++) {
      if (comp[s] >= 0) continue;
      const stack = [s];
      comp[s] = c;
      while (stack.length) {
        const u = stack.pop()!;
        for (const { to } of this.adj[u])
          if (comp[to] < 0) {
            comp[to] = c;
            stack.push(to);
          }
      }
      c++;
    }
    return comp;
  }

  /** Vertex minimising the summed route length to every anchor (where a splice or ground naturally sits). */
  median(anchors: number[]): number | null {
    const uniq = [...new Set(anchors)];
    if (!uniq.length) return null;
    if (uniq.length === 1) return uniq[0];
    const sum = new Float64Array(this.pos.length);
    for (const a of uniq) {
      const { dist } = this.dijkstra([a]);
      for (let i = 0; i < sum.length; i++) sum[i] += dist[i];
    }
    let best = -1;
    for (let i = 0; i < sum.length; i++) if (Number.isFinite(sum[i]) && (best < 0 || sum[i] < sum[best])) best = i;
    return best < 0 ? null : best;
  }
}

function closestOnSegment(p: V3, a: V3, b: V3): V3 {
  const ab = b.clone().sub(a);
  const t = ab.lengthSq() > 0 ? Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
  return a.clone().addScaledVector(ab, t);
}

/** Straight open cylinder from a to b (6 sides) — cheap stand-in for a short harness run. */
function segment(a: V3, b: V3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, Math.max(len, 0.1), 6, 1, true);
  g.deleteAttribute('uv');
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function housing(center: V3, dir: V3, pins: number): THREE.BufferGeometry {
  const n = Math.min(Math.max(pins, 1), 60);
  const size: [number, number, number] = [20 + n * 0.25, 12 + n * 0.55, 12];
  const body = roundedBox(size, 0);
  const latch = roundedBox([size[0] * 0.45, size[1] * 0.35, 3], 0).translate(-size[0] * 0.05, 0, size[2] / 2 + 1.5);
  const g = merge([body, latch]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir));
  g.translate(center.x, center.y, center.z);
  return g;
}

/** Any direction perpendicular to `d`. */
function perpendicular(d: V3): V3 {
  const up = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  return d.clone().cross(up).normalize();
}

const toThree = (p: V3): Vec3 => [Math.round(p.y) * MM_TO_M, Math.round(p.z) * MM_TO_M, Math.round(p.x) * MM_TO_M];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface HarnessResult {
  /** Layout for the vehicle's default wiring publication. */
  layout: WiringLayout;
  /** Layouts for the other publications (other model years / issues), by publication id. */
  layouts: Map<string, WiringLayout>;
  check: CheckResult;
  /** Route lengths compared with the wire lengths printed in the diagrams, with calculated positions for estimated parts. */
  lengthCheck: CheckResult;
}

export interface HarnessOptions {
  /** A publication printing wire lengths (the engineering issue), used where the default one does not. */
  lengths?: EwdData;
  /** Other publications to lay out on the same network. */
  others?: { id: string; data: EwdData }[];
}

export function synthesizeHarness(v: LoadedVehicle, built: Map<string, BuiltNode>, ewd: EwdData, opts: HarnessOptions = {}): HarnessResult {
  const nodes = v.nodes;
  const graph = new Graph();
  const sourceRef = v.vehicle.wiring!.source;
  const lengthsRef = v.vehicle.wiring!.lengths?.source;
  const isAncestor = (a: string, b: string) => {
    let id = nodes.get(b)?.parent ?? null;
    while (id) {
      if (id === a) return true;
      id = nodes.get(id)?.parent ?? null;
    }
    return false;
  };
  const related = (a: string, b: string) => a === b || isAncestor(a, b) || isAncestor(b, a);

  // ---- 1. trunks ---------------------------------------------------------------------------------
  const electricalHarness = (n: ResolvedNode) =>
    n.kind === 'harness' &&
    (n.system === 'electrical' || n.connects.some((c) => (nodes.get(c)!.ewd.length ?? 0) > 0 || nodes.get(c)!.kind === 'connector'));
  /** Dedicated cables (battery leads, sensor pigtails) carry their own wires; nothing else branches off them. */
  const attachable = (n: ResolvedNode) => n.system === 'electrical' && !/cable|strap|pigtail/.test(n.baseId);
  const trunks: { node: ResolvedNode; verts: number[] }[] = [];
  for (const b of built.values()) {
    const n = b.node;
    if (!electricalHarness(n)) continue;
    const g = n.input?.geometry as { gen?: string; points?: [number, number, number][] } | undefined;
    if (g?.gen !== 'tube' || !g.points) continue;
    const pts = g.points.map((p) => new THREE.Vector3(p[0], n.mirrored ? -p[1] : p[1], p[2]).applyMatrix4(b.world));
    trunks.push({ node: n, verts: graph.polyline(pts, n.id) });
  }
  const trunkCount = graph.pos.length;
  const segs: { a: number; b: number; owner: string }[] = [];
  for (const t of trunks) for (let i = 1; i < t.verts.length; i++) segs.push({ a: t.verts[i - 1], b: t.verts[i], owner: t.node.id });

  // splice trunk ends into neighbouring trunks
  let joins = 0;
  for (const t of trunks)
    for (const end of [t.verts[0], t.verts[t.verts.length - 1]]) {
      let best: { q: V3; s: (typeof segs)[number]; d: number } | null = null;
      for (const s of segs) {
        if (s.owner === t.node.id) continue;
        const q = closestOnSegment(graph.pos[end], graph.pos[s.a], graph.pos[s.b]);
        const d = q.distanceTo(graph.pos[end]);
        if (!best || d < best.d) best = { q, s, d };
      }
      if (!best || best.d > JOIN) continue;
      const qi = graph.add(best.q, best.s.owner);
      graph.link(best.s.a, qi);
      graph.link(qi, best.s.b);
      graph.link(end, qi);
      joins++;
    }

  // join islands to the main network at their closest vertices (estimated junctions)
  const estimated: string[] = [];
  for (;;) {
    const comp = graph.components();
    const sizes = new Map<number, number>();
    for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
    if (sizes.size <= 1) break;
    const main = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
    const island = [...sizes.keys()].find((c) => c !== main)!;
    let best: [number, number, number] | null = null;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] !== island) continue;
      for (let j = 0; j < comp.length; j++) {
        if (comp[j] !== main) continue;
        const d = graph.pos[i].distanceTo(graph.pos[j]);
        if (!best || d < best[2]) best = [i, j, d];
      }
    }
    graph.link(best![0], best![1], true);
    estimated.push(`${graph.owner[best![0]]} ↔ ${graph.owner[best![1]]} (${best![2].toFixed(0)} mm)`);
  }

  // ---- generated-node helpers ----------------------------------------------------------------------
  const created: string[] = [];
  const addNode = (spec: {
    id: string;
    parent: string;
    kind: 'harness' | 'connector';
    name: string;
    summary: string;
    worldGeos: { geo: THREE.BufferGeometry; mat: string }[];
    ewdConnectors?: string[];
    connects?: string[];
    locator?: string;
    /** "calculated" when the position was fitted to printed wire lengths. */
    placement?: 'estimated' | 'calculated';
  }) => {
    const parent = built.get(spec.parent)!;
    const inv = parent.world.clone().invert();
    const subs: Sub[] = [];
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    for (const g of spec.worldGeos) byMat.set(g.mat, [...(byMat.get(g.mat) ?? []), g.geo.applyMatrix4(inv)]);
    for (const [mat, geos] of byMat) {
      const geo = merge(geos);
      geo.computeBoundingBox();
      subs.push({ mat, geo });
    }
    const input = {
      id: spec.id,
      kind: spec.kind,
      name: spec.name,
      summary: spec.summary,
      aliases: [],
      partNumbers: [],
      specs: [],
      manufacturing: [],
      ewd: [],
      faults: [],
      detail: false,
      handed: false,
      contacts: [],
      links: [],
      ...(spec.connects ? { harness: { connects: spec.connects } } : {}),
    } as unknown as NodeInputT;
    const node: ResolvedNode = {
      id: spec.id,
      baseId: spec.id,
      parent: spec.parent,
      children: [],
      kind: spec.kind,
      name: spec.name,
      aliases: [],
      system: 'electrical',
      mirrored: false,
      input,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      explode: { dir: [0, 0, 1], dist: 0 },
      verification: {
        geometry: 'schematic',
        placement: spec.placement ?? 'estimated',
        facts: 'oem',
        sources: [
          { ref: sourceRef, ...(spec.locator ? { locator: spec.locator } : {}) },
          ...(spec.placement === 'calculated' && lengthsRef ? [{ ref: lengthsRef, says: 'wire lengths (mm) used to calculate the position' }] : []),
        ],
        reviews: [],
        notes:
          spec.placement === 'calculated'
            ? 'Generated by the data build from the wiring diagrams; the position is calculated from the wire lengths they print.'
            : 'Generated by the data build from the wiring diagrams; the route or position is estimated.',
      },
      removeFirst: [],
      contacts: [],
      connects: spec.connects ?? [],
      links: [],
      ewd: [],
      ewdConnectors: spec.ewdConnectors,
      generated: true,
      file: 'generated by tools/lib/harness.ts',
    };
    nodes.set(spec.id, node);
    v.order.push(spec.id);
    nodes.get(spec.parent)!.children.push(spec.id);
    const box = new THREE.Box3();
    for (const s of subs) box.union(s.geo.boundingBox!);
    const worldBox = box.clone().applyMatrix4(parent.world);
    built.set(spec.id, {
      node,
      local: new THREE.Matrix4(),
      world: parent.world.clone(),
      subs,
      geoKey: `generated:${spec.id}`,
      ownBox: box,
      worldBox,
      subtreeBox: worldBox.clone(),
      triangles: subs.reduce((n, s) => n + (s.geo.index ? s.geo.index.count : s.geo.attributes.position.count) / 3, 0),
    });
    for (let id: string | null = spec.parent; id; id = nodes.get(id)!.parent) built.get(id)!.subtreeBox!.union(worldBox);
    created.push(spec.id);
  };
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const sheetsOf = (codes: string[]) => [...new Set(codes.flatMap((c) => ewd.components[c]?.circuits ?? []))].slice(0, 3).join('; ');

  // ---- 2. connectors of every electrical part -------------------------------------------------------
  const layout: WiringLayout = { v: [], e: [], virtual: [], connectors: {}, splices: {}, grounds: {} };
  const anchorOf = new Map<string, { v: number; p: V3; node: string }>();
  const authoredConnector = new Map<string, ResolvedNode>();
  for (const n of nodes.values()) if (n.input?.connector?.ewd) authoredConnector.set(n.input.connector.ewd, n);
  const attachVerts: number[] = [];
  for (let i = 0; i < trunkCount; i++) if (attachable(nodes.get(graph.owner[i])!)) attachVerts.push(i);
  const harnessNodes = trunks.map((t) => t.node);
  const pinCount = (c: string) => Object.keys(ewd.connectors[c]?.pins ?? {}).length;
  let branches = 0;
  let reachedByAuthored = 0;
  const unanchored: string[] = [];

  const parts = [...nodes.values()].filter((n) => n.ewd.length && !n.generated);
  for (const n of parts) {
    const conns = [...new Set(n.ewd.flatMap((c) => ewd.components[c]?.connectors ?? []))].filter((c) => ewd.connectors[c]);
    if (!conns.length) continue;
    // group connector ids by the node that physically carries them: an authored connector part, or the part itself
    const groups = new Map<string, string[]>();
    for (const c of conns) {
      const k = authoredConnector.get(c);
      const target = k && related(n.id, k.id) ? k.id : n.id;
      groups.set(target, [...(groups.get(target) ?? []), c]);
    }
    for (const [targetId, ids] of groups) {
      const tb = built.get(targetId)!;
      const box = tb.subtreeBox && !tb.subtreeBox.isEmpty() ? tb.subtreeBox : tb.worldBox;
      if (!box || box.isEmpty()) {
        unanchored.push(`${targetId}: no geometry`);
        continue;
      }
      // an authored harness that names this part (or its parent/child) and passes close by already reaches it
      let anchor: { v: number; d: number } | null = null;
      for (const h of harnessNodes) {
        if (!h.connects.some((c) => related(c, targetId) || related(c, n.id))) continue;
        for (let i = 0; i < trunkCount; i++) {
          if (graph.owner[i] !== h.id) continue;
          const d = box.distanceToPoint(graph.pos[i]);
          if (d <= REACH && (!anchor || d < anchor.d)) anchor = { v: i, d };
        }
      }
      if (anchor) {
        reachedByAuthored++;
        const p = box.clampPoint(graph.pos[anchor.v], new THREE.Vector3());
        for (const c of ids) anchorOf.set(c, { v: anchor.v, p, node: targetId });
        for (const c of ids) layout.connectors[c] = { node: targetId, v: anchor.v, p: toThree(p) };
        continue;
      }
      let best = -1;
      let bd = Infinity;
      for (const i of attachVerts) {
        const d = box.distanceToPoint(graph.pos[i]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best < 0) {
        unanchored.push(`${targetId}: no harness trunk`);
        continue;
      }
      const T = graph.pos[best];
      const E = box.clampPoint(T, new THREE.Vector3());
      const authored = targetId !== n.id;
      if (E.distanceTo(T) < 12) {
        for (const c of ids) {
          anchorOf.set(c, { v: best, p: E, node: targetId });
          layout.connectors[c] = { node: targetId, v: best, p: toThree(E) };
        }
        continue;
      }
      // generated branch: trunk → part, sagging slightly, ending in the connector housings
      const dir = E.clone().sub(T).normalize();
      const len = E.distanceTo(T);
      const mid = T.clone().lerp(E, 0.5).add(new THREE.Vector3(0, 0, -Math.min(40, len * 0.08)));
      const id = `branch-${targetId}`;
      const pins = ids.reduce((a, c) => a + pinCount(c), 0);
      const r = Math.min(9, Math.max(3, 2.5 + 0.35 * Math.sqrt(pins)));
      const verts = graph.polyline([T, mid, E], id, best);
      const vE = verts[verts.length - 1];
      const geos: { geo: THREE.BufferGeometry; mat: string }[] = [
        { geo: merge([segment(T, mid, r), segment(mid, E, r)]), mat: 'harness-black' },
      ];
      if (!authored) {
        const perp = perpendicular(dir);
        const widths = ids.map((c) => 12 + Math.min(Math.max(pinCount(c), 1), 60) * 0.55 + 4);
        let offset = -widths.reduce((a, w) => a + w, 0) / 2;
        ids.forEach((c, k) => {
          const w = widths[k];
          const lenX = 20 + Math.min(Math.max(pinCount(c), 1), 60) * 0.25;
          const centre = E.clone().addScaledVector(dir, -(lenX / 2 + 1)).addScaledVector(perp, offset + w / 2);
          offset += w;
          geos.push({ geo: housing(centre, dir, pinCount(c)), mat: HOUSING_MATS[k % HOUSING_MATS.length] });
          anchorOf.set(c, { v: vE, p: centre, node: id });
          layout.connectors[c] = { node: id, v: vE, p: toThree(centre) };
        });
      } else
        for (const c of ids) {
          const p = built.get(targetId)!.worldBox!.getCenter(new THREE.Vector3());
          anchorOf.set(c, { v: vE, p, node: targetId });
          layout.connectors[c] = { node: targetId, v: vE, p: toThree(p) };
        }
      const owner = nodes.get(graph.owner[best])!;
      addNode({
        id,
        parent: targetId,
        kind: 'harness',
        name: `Harness branch to ${nodes.get(targetId)!.name}`,
        summary: `Generated from the wiring diagrams: carries ${pins} circuit${pins === 1 ? '' : 's'} from the ${owner.name.replace(/ \((LH|RH)\)$/, '')} to ${authored ? 'this connector' : `connector${ids.length > 1 ? 's' : ''} ${ids.join(', ')}`}. The route is estimated as the shortest run from the nearest harness trunk.`,
        worldGeos: geos,
        ewdConnectors: authored ? undefined : ids,
        connects: [owner.id, targetId],
        locator: sheetsOf(n.ewd),
      });
      branches++;
    }
  }

  // ---- 3. official wire lengths ------------------------------------------------------------------
  // The diagrams print a wire's length after its colour and cross-section; the publication's own notes
  // say the figure "indicates the approximate position of the harness splice ... from connector Cxxxx".
  // Service issues print lengths for power and ground distribution only, and for wires that cross the
  // car they print the right-hand-drive figures (BJB to CJB 1220 mm against 2130 mm in the LHD engineering
  // issue). So the engineering issue, which prints almost every wire for this market, comes first; it is
  // matched by wire id (with the same ends) or by the two ends.
  const engById = new Map((opts.lengths?.wires ?? []).map((w) => [w.id, w]));
  const engByEnds = new Map((opts.lengths?.wires ?? []).filter((w) => w.ends.length === 2 && w.length).map((w) => [[...w.ends].sort().join('~'), w]));
  const lengthOf = (w: EwdWire): number | undefined => {
    const key = [...w.ends].sort().join('~');
    const e = engById.get(w.id);
    if (e?.length && (w.ends.length < 2 || e.ends.length < 2 || [...e.ends].sort().join('~') === key)) return e.length;
    return (w.ends.length === 2 ? engByEnds.get(key)?.length : undefined) ?? w.length;
  };
  const distCache = new Map<number, Float64Array>();
  const distFrom = (vi: number) => {
    let d = distCache.get(vi);
    if (!d) {
      d = graph.dijkstra([vi]).dist;
      distCache.set(vi, d);
    }
    return d;
  };
  /** A printed length is met when the route is within 20 % (at least 150 mm) of it. */
  const tolerance = (len: number) => Math.max(150, 0.2 * len);
  interface Term {
    v: number;
    /** Distance from the graph vertex to the actual end point (connector housing, splice). */
    off: number;
    len?: number;
  }
  /** Best vertex for something joined by these wires: printed lengths are fitted; ends without one only pull weakly. */
  const fit = (terms: Term[]): { v: number; calculated: boolean; rms?: number; used: number } | null => {
    if (!terms.length) return null;
    const withLen = terms.filter((t) => t.len);
    if (!withLen.length) {
      const m = graph.median(terms.map((t) => t.v));
      return m === null ? null : { v: m, calculated: false, used: 0 };
    }
    const dl = withLen.map((t) => distFrom(t.v));
    const dn = terms.filter((t) => !t.len).map((t) => distFrom(t.v));
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < graph.pos.length; i++) {
      let err = 0;
      for (let k = 0; k < withLen.length; k++) {
        const r = dl[k][i] + withLen[k].off - withLen[k].len!;
        err += r * r;
      }
      for (const d of dn) err += 0.02 * d[i] * d[i];
      if (Number.isFinite(err) && err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    if (best < 0) return null;
    const res = withLen.map((t, k) => dl[k][best] + t.off - t.len!);
    const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
    return { v: best, calculated: withLen.every((t, k) => Math.abs(res[k]) <= tolerance(t.len!)), rms, used: withLen.length };
  };

  // ---- 4. splices, grounds and in-line connectors, per publication -----------------------------------
  const nodeOfCode = new Map<string, string>();
  for (const n of nodes.values()) for (const c of n.ewd) nodeOfCode.set(c, n.id);
  const anchorOfPart = new Map<string, { v: number; p: V3; node: string }>();
  for (const [c, a] of anchorOf) {
    const code = ewd.connectors[c]?.component;
    const part = code ? nodeOfCode.get(code) : undefined;
    if (part && !anchorOfPart.has(part)) anchorOfPart.set(part, a);
  }
  const groundKey = (end: string) => end.replace(/-\d+$/, '');
  const used = new Map<number, number>();
  /** Co-located items are stacked 24 mm apart so they stay distinct. */
  const stack = (vi: number): V3 => {
    const k = used.get(vi) ?? 0;
    used.set(vi, k + 1);
    return graph.pos[vi].clone().add(new THREE.Vector3(0, 0, 24 * k));
  };
  const lengthsUsed = (t: { calculated: boolean; rms?: number; used: number }) =>
    t.used ? `Fitted to ${t.used} wire length${t.used === 1 ? '' : 's'} printed in the wiring diagrams (route error ${Math.round(t.rms!)} mm).` : 'No printed wire length: placed where its wires meet.';

  interface Placement {
    layout: WiringLayout;
    routable: number;
    twoEnded: number;
    otherEquipment: number;
    splices: number;
    grounds: number;
    inline: number;
    calculated: number;
    inlineMissing: string[];
    unplacedGrounds: string[];
    resolve: (end: string) => { v: number; p: V3 } | null;
  }
  const place = (data: EwdData, primary: boolean): Placement => {
    const L: WiringLayout = { v: [], e: [], virtual: [], connectors: {}, splices: {}, grounds: {}, calc: {} };
    // connector anchors from the branch build; a connector only this publication has sits with its part's others
    const anchors = new Map(anchorOf);
    for (const [cid, c] of Object.entries(data.connectors)) {
      if (anchors.has(cid) || !c.component) continue;
      const part = nodeOfCode.get(c.component);
      const a = part ? anchorOfPart.get(part) : undefined;
      if (a) anchors.set(cid, a);
    }
    for (const [cid, a] of anchors) if (data.connectors[cid]) L.connectors[cid] = { node: a.node, v: a.v, p: toThree(a.p) };
    const wiresById = new Map(data.wires.map((w) => [w.id, w]));
    const spliceAt = new Map<string, { v: number; p: V3 }>();
    const groundAt = new Map<string, { v: number; p: V3; fit: ReturnType<typeof fit> }>();
    const resolve = (end: string): { v: number; p: V3 } | null => {
      if (/^S\d/.test(end)) return spliceAt.get(end) ?? null;
      if (/^G\d/.test(end)) return groundAt.get(groundKey(end)) ?? null;
      const a = anchors.get(splitPin(end).connector);
      return a ? { v: a.v, p: a.p } : null;
    };
    /** Terms for something at `self`: the far end of each of its wires, with the wire's printed length. */
    const termsFor = (wireIds: string[], self: (end: string) => boolean): Term[] =>
      wireIds.flatMap((id) => {
        const w = wiresById.get(id);
        if (!w) return [];
        return w.ends
          .filter((e) => !self(e))
          .flatMap((e) => {
            const r = resolve(e);
            return r ? [{ v: r.v, off: r.p.distanceTo(graph.pos[r.v]), len: lengthOf(w) }] : [];
          });
      });
    const pairs: { key: string; a: string; b: string; at?: ReturnType<typeof fit> }[] = [];
    const seen = new Set<string>();
    for (const [cid, c] of Object.entries(data.connectors)) {
      if (!c.mates || c.component) continue;
      const key = [cid, c.mates].sort().join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = key.split('/');
      pairs.push({ key, a, b });
    }
    const pinWires = (conn: string) => Object.values(data.connectors[conn]?.pins ?? {}).flatMap((p) => p.wires);
    const ownPin = (conn: string) => (e: string) => !/^[SG]\d/.test(e) && splitPin(e).connector === conn;
    const spliceFit = new Map<string, ReturnType<typeof fit>>();
    for (let pass = 0, progress = true; progress && pass < 8; pass++) {
      progress = false;
      for (const [sid, sp] of Object.entries(data.splices)) {
        if (spliceAt.has(sid)) continue;
        const f = fit(termsFor(sp.wires, (e) => e === sid));
        if (f) {
          spliceAt.set(sid, { v: f.v, p: graph.pos[f.v].clone() });
          spliceFit.set(sid, f);
          progress = true;
        }
      }
      for (const [gid, g] of Object.entries(data.grounds)) {
        if (groundAt.has(gid)) continue;
        const f = fit(termsFor(g.wires, (e) => groundKey(e) === gid));
        if (f) {
          groundAt.set(gid, { v: f.v, p: graph.pos[f.v].clone(), fit: f });
          progress = true;
        }
      }
      for (const pr of pairs) {
        if (pr.at) continue;
        // both halves join at one point: the wires on each side are measured from it
        const f = fit([...termsFor(pinWires(pr.a), ownPin(pr.a)), ...termsFor(pinWires(pr.b), ownPin(pr.b))]);
        if (!f) continue;
        pr.at = f;
        for (const conn of [pr.a, pr.b]) anchors.set(conn, { v: f.v, p: graph.pos[f.v].clone(), node: '' });
        progress = true;
      }
    }

    let calculated = 0;
    for (const [sid, at] of spliceAt) {
      const f = spliceFit.get(sid)!;
      L.splices[sid] = { v: at.v, p: toThree(at.p) };
      if (f?.used) L.calc![sid] = { rms: Math.round(f.rms!), wires: f.used, calculated: f.calculated };
      if (f?.calculated) calculated++;
    }
    for (const [gid, at] of groundAt) {
      const g = data.grounds[gid];
      const f = at.fit!;
      const id = `ground-${slug(gid)}`;
      const p = primary ? stack(at.v) : at.p;
      L.grounds[gid] = { node: primary ? id : undefined, v: at.v, p: toThree(p) };
      if (f.used) L.calc![gid] = { rms: Math.round(f.rms!), wires: f.used, calculated: f.calculated };
      if (f.calculated) calculated++;
      if (!primary) continue;
      const eyelet = new THREE.CylinderGeometry(9, 9, 3, 12);
      const bolt = new THREE.CylinderGeometry(6, 6, 7, 6).translate(0, 4.5, 0);
      const geo = merge([eyelet, bolt].map((x) => (x.deleteAttribute('uv'), x)));
      geo.rotateX(Math.PI / 2).translate(p.x, p.y, p.z);
      addNode({
        id,
        parent: 'electrical',
        kind: 'connector',
        name: `Ground point ${gid}`,
        summary: `Body ground ${gid} (${g.wires.length} wire${g.wires.length === 1 ? '' : 's'}). The wiring diagrams give connections, not positions. ${lengthsUsed(f)}`,
        worldGeos: [{ geo, mat: 'copper' }],
        placement: f.calculated ? 'calculated' : 'estimated',
        locator: [...new Set(g.wires.flatMap((w) => wiresById.get(w)?.sheets ?? []))].slice(0, 2).join('; '),
      });
    }
    const inlineMissing: string[] = [];
    for (const pr of pairs) {
      const { a, b, at } = pr;
      if (!at) {
        inlineMissing.push(pr.key);
        continue;
      }
      if (at.used) L.calc![pr.key] = { rms: Math.round(at.rms!), wires: at.used, calculated: at.calculated };
      if (at.calculated) calculated++;
      const id = `inline-${slug(a)}`;
      const p = primary ? stack(at.v) : graph.pos[at.v];
      for (const conn of [a, b]) {
        anchors.set(conn, { v: at.v, p, node: primary ? id : '' });
        L.connectors[conn] = { node: primary ? id : '', v: at.v, p: toThree(p) };
      }
      if (!primary) continue;
      const owner = nodes.get(graph.owner[at.v])!;
      const parentId = owner.generated ? owner.parent! : owner.id;
      const dir = new THREE.Vector3(1, 0, 0);
      const pins = Math.max(pinCount(a), pinCount(b));
      addNode({
        id,
        parent: parentId,
        kind: 'connector',
        name: `In-line connector ${a}/${b}`,
        summary: `Joins two harness sections (${pins} pin${pins === 1 ? '' : 's'}). The diagrams print its connections, not its position. ${lengthsUsed(at)}`,
        worldGeos: [
          { geo: housing(p.clone().add(new THREE.Vector3(-9, 0, 0)), dir, pins), mat: 'connector-black' },
          { geo: housing(p.clone().add(new THREE.Vector3(9, 0, 0)), dir.clone().negate(), pins), mat: 'connector-grey' },
        ],
        ewdConnectors: [a, b],
        placement: at.calculated ? 'calculated' : 'estimated',
        locator: [...new Set(pinWires(a).flatMap((w) => wiresById.get(w)?.sheets ?? []))].slice(0, 2).join('; '),
      });
    }
    // wires to equipment this variant does not have (other engine, gearbox or market) cannot be drawn by design
    const fitted = relevantEwdComponents(data, new Set((v.vehicle.wiring!.notApplicable ?? []).flatMap((n) => n.codes)));
    const notFitted = (end: string) => {
      if (/^[SG]\d/.test(end)) return false;
      const comp = data.connectors[splitPin(end).connector]?.component;
      return !!comp && !fitted.has(comp);
    };
    const twoEnded = data.wires.filter((w) => w.ends.length === 2);
    const routable = twoEnded.filter((w) => w.ends.every((e) => resolve(e) !== null)).length;
    const otherEquipment = twoEnded.filter((w) => w.ends.some((e) => resolve(e) === null) && w.ends.some(notFitted)).length;
    return {
      layout: L,
      routable,
      twoEnded: twoEnded.length,
      otherEquipment,
      splices: spliceAt.size,
      grounds: groundAt.size,
      inline: pairs.length - inlineMissing.length,
      calculated,
      inlineMissing,
      unplacedGrounds: Object.keys(data.grounds).filter((g) => !groundAt.has(g)),
      resolve,
    };
  };

  const main = place(ewd, true);
  const layouts = new Map<string, WiringLayout>();
  const others = (opts.others ?? []).map((o) => ({ id: o.id, p: place(o.data, false) }));

  // ---- 5. graph, report --------------------------------------------------------------------------------
  const graphV = graph.pos.flatMap((p) => toThree(p).map(r3));
  const graphE: number[] = [];
  const graphVirtual: number[] = [];
  for (const e of graph.edges) {
    graphE.push(e.a, e.b);
    graphVirtual.push(e.virtual ? 1 : 0);
  }
  for (const L of [main.layout, ...others.map((o) => o.p.layout)]) Object.assign(L, { v: graphV, e: graphE, virtual: graphVirtual });
  for (const o of others) layouts.set(o.id, o.p.layout);

  const missingParts = parts.filter((n) => n.ewd.some((c) => (ewd.components[c]?.connectors ?? []).some((k) => !anchorOf.has(k))));
  const lines = [
    `${trunks.length} authored harness runs → ${graph.pos.length} graph vertices; ${joins} trunk junctions${estimated.length ? `, ${estimated.length} estimated (islands joined at the closest point): ${estimated.join('; ')}` : ''}`,
    `${branches} generated branches; ${reachedByAuthored} parts reached by an authored harness`,
    `${main.inline} in-line connector pairs, ${main.splices}/${Object.keys(ewd.splices).length} splices, ${main.grounds}/${Object.keys(ewd.grounds).length} ground points placed; ${main.calculated} of them calculated from printed wire lengths`,
    `${main.routable} of ${main.twoEnded} two-ended wires can be drawn end to end; ${main.otherEquipment} more lead to equipment this variant does not have; ${main.twoEnded - main.routable - main.otherEquipment} reach an unplaced splice, ground or unassigned connector`,
    ...others.map((o) => `other publication ${o.id}: ${o.p.routable} of ${o.p.twoEnded - o.p.otherEquipment} wires drawable, ${o.p.calculated} positions calculated`),
    ...unanchored.map((u) => `unanchored: ${u}`),
    ...(main.inlineMissing.length ? [`in-line pairs whose wires reach no placed part (MOST fibre-optic links are not printed as wires), not placed: ${main.inlineMissing.join(', ')}`] : []),
    ...(main.unplacedGrounds.length ? [`grounds whose wires reach no placed part, not placed: ${main.unplacedGrounds.join(', ')}`] : []),
  ];
  const ok = !unanchored.length && !missingParts.length;

  // ---- 6. printed wire lengths vs the model ------------------------------------------------------------
  // Each wire between two parts with a printed length should be about as long as its route along the
  // harnesses. Parts whose wires disagree are out of place (or a trunk route is); for parts whose position
  // is only estimated, the best position along the network is calculated from the same lengths.
  let checked = 0;
  let within = 0;
  const byPart = new Map<string, number[]>();
  for (const w of ewd.wires) {
    const len = lengthOf(w);
    if (!len || w.ends.length !== 2 || w.ends.some((e) => /^[SG]\d/.test(e))) continue;
    const [ea, eb] = w.ends.map((e) => anchorOf.get(splitPin(e).connector));
    if (!ea || !eb || !ewd.connectors[splitPin(w.ends[0]).connector]?.component || !ewd.connectors[splitPin(w.ends[1]).connector]?.component) continue;
    const route = distFrom(ea.v)[eb.v] + ea.p.distanceTo(graph.pos[ea.v]) + eb.p.distanceTo(graph.pos[eb.v]);
    if (!Number.isFinite(route)) continue;
    checked++;
    if (Math.abs(route - len) <= tolerance(len)) within++;
    for (const e of w.ends) {
      const code = ewd.connectors[splitPin(e).connector]?.component;
      const part = code ? nodeOfCode.get(code) : undefined;
      if (part) byPart.set(part, [...(byPart.get(part) ?? []), route - len]);
    }
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const off = [...byPart]
    .map(([part, d]) => ({ part, d: median(d), n: d.length }))
    .filter((x) => Math.abs(x.d) > 400 && x.n >= 2)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  // A review list, not an error: the printed lengths follow the real harness runs, which the documents
  // in hand do not draw (some reach the rear a long way round), so a mismatch can mean a misplaced part
  // or a different harness route.
  const lengthCheck: CheckResult = {
    id: 'wire-lengths',
    severity: 'info',
    title: `Printed wire lengths: ${within} of ${checked} wires between parts match their modelled route within 20 %`,
    nodes: off.map((x) => x.part),
    detail: [
      'Parts whose wires differ most from the printed lengths (a misplaced part, or a harness that runs differently from the modelled trunks):',
      ...off.slice(0, 40).map((x) => `${x.part}: modelled routes ${x.d > 0 ? 'longer' : 'shorter'} than the printed wires by ${Math.round(Math.abs(x.d))} mm (median of ${x.n})`),
    ].join('\n'),
  };

  return {
    layout: main.layout,
    layouts,
    lengthCheck,
    check: {
      id: 'electrical-network',
      severity: ok ? 'info' : 'error',
      title: ok
        ? `Every electrical part is wired into one harness network (${branches} generated branches; ${main.routable} of ${main.twoEnded - main.otherEquipment} wires drawable; ${main.calculated} splice, ground and in-line positions calculated from printed lengths)`
        : `${missingParts.length} electrical part(s) are not connected to the harness network`,
      nodes: missingParts.map((n) => n.id),
      detail: lines.join('\n'),
    },
  };
}
