/**
 * Wiring netlist access for the UI. The JSON is fetched lazily — only when
 * someone opens a wiring view — and indexed once.
 */
import type { Manifest, RuntimeNode, WiringPublication } from '../shared/manifest';
import { endKind, splitPin, type EwdData, type EwdWire } from '../shared/wiring';
import { asset } from './router';

export interface WiringIndex {
  data: EwdData;
  wiresByEnd: Map<string, EwdWire[]>;
  /** EWD component code → model node id. */
  nodeOfCode: Map<string, string>;
  /** Connector id → model node id (connector nodes that name their EWD connector). */
  nodeOfConnector: Map<string, string>;
  /** Fuse ids touching a pin. */
  fusesByPin: Map<string, { id: string; rating?: number }[]>;
  wireById: Map<string, EwdWire>;
  /** Components the diagrams print that this variant does not have. */
  notFitted: Set<string>;
  /** Routing graph over the harnesses (built lazily from data.layout). */
  graph?: RouteGraph;
}

interface RouteGraph {
  pos: Float32Array;
  adj: { to: number; w: number }[][];
}

const cache = new Map<string, Promise<WiringIndex>>();

/** The publication to show: the one picked in the Wiring tab, else the vehicle's default. */
export function publicationOf(manifest: Manifest, pubId?: string | null): WiringPublication | null {
  const w = manifest.wiring;
  if (!w) return null;
  return w.publications.find((p) => p.id === pubId) ?? w.publications.find((p) => p.isDefault) ?? null;
}

/** Loads (once per publication) and indexes a wiring netlist. */
export function loadWiring(manifest: Manifest, pubId?: string | null): Promise<WiringIndex> | null {
  const pub = publicationOf(manifest, pubId);
  const url = pub?.url ?? manifest.wiring?.url;
  if (!url) return null;
  let promise = cache.get(url);
  if (!promise) {
    promise = fetch(asset(url))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: EwdData) => buildIndex(data, manifest));
    cache.set(url, promise);
  }
  return promise;
}

/** Fetches, indexes and builds the routing graph of the default wiring in advance (call when idle). */
export function prepareWiring(manifest: Manifest): void {
  loadWiring(manifest)
    ?.then((ix) => graphOf(ix))
    .catch(() => {});
}

export function buildIndex(data: EwdData, manifest: Manifest): WiringIndex {
  const wiresByEnd = new Map<string, EwdWire[]>();
  for (const w of data.wires)
    for (const e of w.ends) {
      const key = endKind(e) === 'ground' ? e.replace(/-\d+$/, '') : e;
      if (!wiresByEnd.has(key)) wiresByEnd.set(key, []);
      wiresByEnd.get(key)!.push(w);
    }
  const nodeOfCode = new Map<string, string>();
  const nodeOfConnector = new Map<string, string>();
  for (const n of manifest.nodes) {
    for (const c of n.ewd) nodeOfCode.set(c, n.id);
    if (n.connector?.ewd) nodeOfConnector.set(n.connector.ewd, n.id);
    // generated harness branches and in-line connectors carry their connector ids
    for (const c of n.ewdConnectors ?? []) if (!nodeOfConnector.has(c)) nodeOfConnector.set(c, n.id);
  }
  const fusesByPin = new Map<string, { id: string; rating?: number }[]>();
  for (const [id, f] of Object.entries(data.fuses))
    for (const p of f.between) {
      if (!fusesByPin.has(p)) fusesByPin.set(p, []);
      fusesByPin.get(p)!.push({ id, rating: f.rating });
    }
  // petrol-only sheets and the vehicle's not-applicable list (same rule as the data build)
  const notFitted = new Set((manifest.wiring?.notApplicable ?? []).flatMap((n) => n.codes));
  for (const [code, c] of Object.entries(data.components))
    if (c.circuits.length && c.circuits.every((sh) => /\bpetrol\b|\bP6\b/i.test(sh))) notFitted.add(code);
  return { data, wiresByEnd, nodeOfCode, nodeOfConnector, fusesByPin, wireById: new Map(data.wires.map((w) => [w.id, w])), notFitted };
}

export interface EndInfo {
  raw: string;
  kind: 'pin' | 'splice' | 'ground';
  label: string;
  component?: string;
  componentName?: string;
  node?: string;
}

export function describeEnd(ix: WiringIndex, end: string): EndInfo {
  const kind = endKind(end);
  if (kind === 'splice') return { raw: end, kind, label: `Splice ${end}` };
  if (kind === 'ground') {
    const g = end.replace(/-\d+$/, '');
    return { raw: end, kind, label: `Ground ${g}`, node: ix.data.layout?.grounds[g]?.node };
  }
  const { connector, pin } = splitPin(end);
  const c = ix.data.connectors[connector];
  const code = c?.component ?? undefined;
  const comp = code ? ix.data.components[code] : undefined;
  const node = (code && ix.nodeOfCode.get(code)) || ix.nodeOfConnector.get(connector);
  const inline = c?.mates ? ` (in-line, mates ${c.mates})` : '';
  return {
    raw: end,
    kind,
    label: comp ? `${comp.name} · ${connector}-${pin}` : `${connector}-${pin}${inline}`,
    component: code,
    componentName: comp?.name,
    node,
  };
}

/** Pins of a connector in numeric order, each with its wires. */
export function pinsOf(ix: WiringIndex, connector: string): { pin: string; signal?: string; wires: EwdWire[] }[] {
  const c = ix.data.connectors[connector];
  if (!c) return [];
  const byId = new Map(ix.data.wires.map((w) => [w.id, w]));
  return Object.entries(c.pins)
    .map(([pin, p]) => ({ pin, signal: p.signal, wires: p.wires.map((id) => byId.get(id)).filter((w): w is EwdWire => !!w) }))
    .sort((a, b) => (parseInt(a.pin, 10) || 0) - (parseInt(b.pin, 10) || 0) || a.pin.localeCompare(b.pin));
}

/** Model node ids for every component on a circuit sheet (unmapped components are returned separately). */
export function circuitNodes(ix: WiringIndex, circuitId: string): { mapped: string[]; unmapped: { code: string; name: string }[] } {
  const circuit = ix.data.circuits.find((c) => c.id === circuitId);
  const mapped = new Set<string>();
  const unmapped: { code: string; name: string }[] = [];
  for (const code of circuit?.components ?? []) {
    const node = ix.nodeOfCode.get(code);
    if (node) mapped.add(node);
    else unmapped.push({ code, name: ix.data.components[code]?.name ?? code });
  }
  return { mapped: [...mapped], unmapped };
}

// ---------------------------------------------------------------- wire routes

/** Wiring-diagram connector ids a model node carries (its components' connectors, or a generated node's own). */
export function connectorsOfNode(ix: WiringIndex, n: RuntimeNode): string[] {
  const out = new Set<string>(n.ewdConnectors ?? []);
  for (const code of n.ewd) for (const c of ix.data.components[code]?.connectors ?? []) out.add(c);
  if (n.connector?.ewd) out.add(n.connector.ewd);
  return [...out];
}

/** Wires touching a node: through its connectors, or at a generated ground point. */
export function wiresOfNode(ix: WiringIndex, n: RuntimeNode): EwdWire[] {
  const out = new Map<string, EwdWire>();
  for (const c of connectorsOfNode(ix, n))
    for (const p of Object.values(ix.data.connectors[c]?.pins ?? {}))
      for (const id of p.wires) {
        const w = ix.wireById.get(id);
        if (w) out.set(id, w);
      }
  for (const [g, info] of Object.entries(ix.data.layout?.grounds ?? {}))
    if (info.node === n.id) for (const w of ix.wiresByEnd.get(g) ?? []) out.set(w.id, w);
  return [...out.values()];
}

export function wiresOfCircuit(ix: WiringIndex, circuitId: string): EwdWire[] {
  return ix.data.wires.filter((w) => w.sheets.includes(circuitId));
}

function graphOf(ix: WiringIndex): RouteGraph | null {
  const L = ix.data.layout;
  if (!L) return null;
  if (ix.graph) return ix.graph;
  const pos = Float32Array.from(L.v);
  const n = pos.length / 3;
  const adj: RouteGraph['adj'] = Array.from({ length: n }, () => []);
  for (let i = 0; i < L.e.length; i += 2) {
    const a = L.e[i];
    const b = L.e[i + 1];
    const d = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]) * (L.virtual[i / 2] ? 1.6 : 1);
    adj[a].push({ to: b, w: d });
    adj[b].push({ to: a, w: d });
  }
  ix.graph = { pos, adj };
  return ix.graph;
}

function shortestTree(g: RouteGraph, src: number): Int32Array {
  const n = g.adj.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  // binary heap of [dist, vertex] in two parallel arrays (plain swaps: no allocation in the hot loop)
  const hd: number[] = [];
  const hv: number[] = [];
  const swap = (i: number, j: number) => {
    const d = hd[i];
    hd[i] = hd[j];
    hd[j] = d;
    const v = hv[i];
    hv[i] = hv[j];
    hv[j] = v;
  };
  const push = (d: number, v: number) => {
    hd.push(d);
    hv.push(v);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      swap(p, i);
      i = p;
    }
  };
  /** Removes the nearest vertex; its distance is left in `top`. */
  let top = 0;
  const pop = (): number => {
    top = hd[0];
    const u = hv[0];
    const d = hd.pop()!;
    const v = hv.pop()!;
    if (hd.length) {
      hd[0] = d;
      hv[0] = v;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        swap(m, i);
        i = m;
      }
    }
    return u;
  };
  dist[src] = 0;
  push(0, src);
  while (hd.length) {
    const u = pop();
    const d = top;
    if (d > dist[u]) continue;
    for (const { to, w } of g.adj[u])
      if (d + w < dist[to]) {
        dist[to] = d + w;
        prev[to] = u;
        push(dist[to], to);
      }
  }
  return prev;
}

export interface WireRoute {
  wire: EwdWire;
  /** Polyline in three.js metres, from the first end to the second. */
  points: [number, number, number][];
}

/** Where a wire end sits on the harness graph (connector housing, splice or ground point). */
function endPoint(ix: WiringIndex, end: string): { v: number; p: [number, number, number] } | null {
  const L = ix.data.layout;
  if (!L) return null;
  const kind = endKind(end);
  if (kind === 'splice') return L.splices[end] ?? null;
  if (kind === 'ground') return L.grounds[end.replace(/-\d+$/, '')] ?? null;
  return L.connectors[splitPin(end).connector] ?? null;
}

/** Routes wires along the harness graph; wires with an end that has no position are skipped. */
export function routeWires(ix: WiringIndex, wires: EwdWire[]): WireRoute[] {
  const g = graphOf(ix);
  if (!g) return [];
  const trees = new Map<number, Int32Array>();
  const out: WireRoute[] = [];
  for (const wire of wires) {
    if (wire.ends.length !== 2) continue;
    const a = endPoint(ix, wire.ends[0]);
    const b = endPoint(ix, wire.ends[1]);
    if (!a || !b) continue;
    let prev = trees.get(a.v);
    if (!prev) {
      prev = shortestTree(g, a.v);
      trees.set(a.v, prev);
    }
    const path: number[] = [];
    for (let u = b.v; u >= 0; u = prev[u]) {
      path.push(u);
      if (u === a.v) break;
    }
    if (path[path.length - 1] !== a.v) continue;
    path.reverse();
    const points: [number, number, number][] = [a.p];
    for (const u of path) points.push([g.pos[3 * u], g.pos[3 * u + 1], g.pos[3 * u + 2]]);
    points.push(b.p);
    out.push({ wire, points });
  }
  return out;
}

export interface ElectricalNeighbour {
  node: string;
  /** Wires that join the two parts (directly, or through one splice or in-line connector). */
  wires: Set<string>;
  via: Set<'direct' | 'splice' | 'in-line connector' | 'ground'>;
}

/** Parts a node is wired to, read from the netlist: pin to pin, through a splice or an in-line connector, or to a ground point. */
export function electricalNeighbours(ix: WiringIndex, n: RuntimeNode): ElectricalNeighbour[] {
  const own = new Set(connectorsOfNode(ix, n));
  const out = new Map<string, ElectricalNeighbour>();
  const add = (node: string | undefined, wire: string, via: ElectricalNeighbour['via'] extends Set<infer V> ? V : never) => {
    if (!node || node === n.id) return;
    const e = out.get(node) ?? { node, wires: new Set<string>(), via: new Set() };
    e.wires.add(wire);
    e.via.add(via);
    out.set(node, e);
  };
  const nodeOfPin = (end: string) => {
    const { connector } = splitPin(end);
    const code = ix.data.connectors[connector]?.component;
    return (code && ix.nodeOfCode.get(code)) || ix.nodeOfConnector.get(connector);
  };
  for (const w of wiresOfNode(ix, n))
    for (const end of w.ends) {
      const kind = endKind(end);
      if (kind === 'pin' && own.has(splitPin(end).connector)) continue;
      if (kind === 'ground') {
        add(ix.data.layout?.grounds[end.replace(/-\d+$/, '')]?.node, w.id, 'ground');
        continue;
      }
      if (kind === 'splice') {
        for (const sw of ix.wiresByEnd.get(end) ?? [])
          if (sw.id !== w.id) for (const e2 of sw.ends) if (e2 !== end && endKind(e2) === 'pin' && !own.has(splitPin(e2).connector)) add(nodeOfPin(e2), w.id, 'splice');
        continue;
      }
      const { connector, pin } = splitPin(end);
      const c = ix.data.connectors[connector];
      if (c && !c.component && c.mates) {
        // in-line connector: continue on the same pin of the mating half
        const mateEnd = `${c.mates}-${pin}`;
        for (const mw of ix.wiresByEnd.get(mateEnd) ?? [])
          for (const e2 of mw.ends) if (e2 !== mateEnd && endKind(e2) === 'pin' && !own.has(splitPin(e2).connector)) add(nodeOfPin(e2), w.id, 'in-line connector');
        continue;
      }
      add(nodeOfPin(end), w.id, 'direct');
    }
  return [...out.values()].sort((a, b) => b.wires.size - a.wires.size);
}
