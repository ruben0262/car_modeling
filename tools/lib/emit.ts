/**
 * Writes a vehicle's runtime package: one GLB per physical root (system),
 * one GLB per lazily-loaded detail assembly, and manifest.json.
 *
 * GLB conventions the viewer relies on:
 *  - every component is a node named by its id carrying its local transform
 *  - its own geometry hangs off a child node "<id>__mesh" (identity transform)
 *  - a detail assembly carries "<id>__proxy" (merged children) in the parent
 *    chunk; its detail chunk has a root "<id>__detail" holding the children
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Logger, NodeIO, type Buffer as GBuffer, type Material as GMaterial, type Mesh as GMesh, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { isoDirToThree, isoToThreeMatrixElements, MM_TO_M, type Vec3 } from '../../src/shared/frames';
import {
  MANIFEST_SCHEMA_VERSION,
  type CheckResult,
  type ChunkInfo,
  type Manifest,
  type PublicationChanges,
  type RuntimeNode,
  type SourceInfo,
  type WiringPublication,
} from '../../src/shared/manifest';
import { MATERIALS, type MaterialId } from '../../src/shared/materials';
import { verificationScore, verificationStatus } from '../../src/shared/verification';
import type { EwdData, WiringLayout } from '../../src/shared/wiring';
import { merge, type Sub } from '../geometry/util';
import type { BuiltNode } from './assemble';
import type { LoadedVehicle } from './load';
import type { DescriptionsFileT } from './schema';

const C = new THREE.Matrix4().fromArray(isoToThreeMatrixElements());
const Cinv = C.clone().invert();

function toThreeMatrix(isoLocal: THREE.Matrix4): THREE.Matrix4 {
  return C.clone().multiply(isoLocal).multiply(Cinv);
}

function box3ToThree(b: THREE.Box3): { min: Vec3; max: Vec3 } {
  // axis permutation keeps min/max per axis: three = (iso.y, iso.z, iso.x)
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    min: [r(b.min.y * MM_TO_M), r(b.min.z * MM_TO_M), r(b.min.x * MM_TO_M)],
    max: [r(b.max.y * MM_TO_M), r(b.max.z * MM_TO_M), r(b.max.x * MM_TO_M)],
  };
}

class ChunkWriter {
  doc = new Document();
  buffer: GBuffer;
  scene;
  materials = new Map<string, GMaterial>();
  meshes = new Map<string, GMesh>();
  triangles = 0;

  constructor(public id: string) {
    this.doc.setLogger(new Logger(Logger.Verbosity.WARN));
    this.buffer = this.doc.createBuffer();
    this.scene = this.doc.createScene(id);
  }

  material(id: string): GMaterial {
    let m = this.materials.get(id);
    if (m) return m;
    const d = MATERIALS[id as MaterialId];
    const c = new THREE.Color(d.color); // linear working space
    const opacity = 'opacity' in d ? d.opacity : 1;
    m = this.doc
      .createMaterial(id)
      .setBaseColorFactor([c.r, c.g, c.b, opacity])
      .setMetallicFactor(d.metalness)
      .setRoughnessFactor(d.roughness)
      .setDoubleSided('doubleSided' in d ? !!d.doubleSided : false)
      .setAlphaMode(opacity < 1 ? 'BLEND' : 'OPAQUE');
    this.materials.set(id, m);
    return m;
  }

  mesh(key: string, name: string, subs: Sub[]): GMesh {
    const cached = this.meshes.get(key);
    if (cached) return cached;
    const mesh = this.doc.createMesh(name);
    for (const s of subs) {
      const g = s.geo;
      const src = g.attributes.position.array as ArrayLike<number>;
      const nsrc = g.attributes.normal.array as ArrayLike<number>;
      const P = new Float32Array(src.length);
      const N = new Float32Array(nsrc.length);
      for (let i = 0; i < src.length; i += 3) {
        P[i] = src[i + 1] * MM_TO_M;
        P[i + 1] = src[i + 2] * MM_TO_M;
        P[i + 2] = src[i] * MM_TO_M;
        N[i] = nsrc[i + 1];
        N[i + 1] = nsrc[i + 2];
        N[i + 2] = nsrc[i];
      }
      const count = src.length / 3;
      const idxSrc = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: count }, (_, i) => i);
      const I = count > 65535 ? Uint32Array.from(idxSrc) : Uint16Array.from(idxSrc);
      this.triangles += I.length / 3;
      const prim = this.doc
        .createPrimitive()
        .setAttribute('POSITION', this.doc.createAccessor().setType('VEC3').setArray(P).setBuffer(this.buffer))
        .setAttribute('NORMAL', this.doc.createAccessor().setType('VEC3').setArray(N).setBuffer(this.buffer))
        .setIndices(this.doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(this.buffer))
        .setMaterial(this.material(s.mat));
      mesh.addPrimitive(prim);
    }
    this.meshes.set(key, mesh);
    return mesh;
  }

  node(name: string, isoLocal: THREE.Matrix4 | null): GNode {
    const n = this.doc.createNode(name);
    if (isoLocal) {
      const m = toThreeMatrix(isoLocal);
      const t = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      m.decompose(t, q, s);
      n.setTranslation([t.x, t.y, t.z]).setRotation([q.x, q.y, q.z, q.w]);
    }
    return n;
  }

  async write(io: NodeIO): Promise<Uint8Array> {
    await this.doc.transform(dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    return io.writeBinary(this.doc);
  }
}

export interface EmitResult {
  manifest: Manifest;
  files: string[];
}

export async function emitVehicle(
  v: LoadedVehicle,
  built: Map<string, BuiltNode>,
  checks: CheckResult[],
  outRoot: string,
  layouts?: { main: WiringLayout; others: Map<string, WiringLayout> },
  library?: DescriptionsFileT,
): Promise<EmitResult> {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const vid = v.vehicle.id;
  const outDir = join(outRoot, 'vehicles', vid);
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) rmSync(join(outDir, f));

  const chunkOf = new Map<string, string>();
  const detailOf = new Map<string, string>();
  const pending: { chunk: ChunkWriter; role: 'system' | 'detail'; root: string }[] = [];

  const isDetail = (b: BuiltNode) => b.node.input?.detail === true && b.node.children.length > 0;

  const proxySubs = (b: BuiltNode): Sub[] => {
    const inv = b.world.clone().invert();
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    const walk = (id: string) => {
      const d = built.get(id)!;
      if (d.subs.length) {
        const m = inv.clone().multiply(d.world);
        for (const s of d.subs) {
          if (!byMat.has(s.mat)) byMat.set(s.mat, []);
          byMat.get(s.mat)!.push(s.geo.clone().applyMatrix4(m));
        }
      }
      for (const c of d.node.children) walk(c);
    };
    for (const c of b.node.children) walk(c);
    return [...byMat].map(([mat, geos]) => ({ mat, geo: merge(geos) }));
  };

  const emitNode = (cw: ChunkWriter, b: BuiltNode, parent: GNode | null) => {
    const gn = cw.node(b.node.id, b.local);
    if (parent) parent.addChild(gn);
    else cw.scene.addChild(gn);
    chunkOf.set(b.node.id, cw.id);
    if (b.subs.length) gn.addChild(cw.node(`${b.node.id}__mesh`, null).setMesh(cw.mesh(b.geoKey!, b.node.id, b.subs)));
    if (isDetail(b)) {
      const subs = proxySubs(b);
      if (subs.length) gn.addChild(cw.node(`${b.node.id}__proxy`, null).setMesh(cw.mesh(`proxy:${b.node.id}`, `${b.node.id}__proxy`, subs)));
      const dc = new ChunkWriter(`detail-${b.node.id}`);
      const root = dc.node(`${b.node.id}__detail`, null);
      dc.scene.addChild(root);
      detailOf.set(b.node.id, dc.id);
      pending.push({ chunk: dc, role: 'detail', root: b.node.id });
      for (const c of b.node.children) emitNode(dc, built.get(c)!, root);
      return;
    }
    for (const c of b.node.children) emitNode(cw, built.get(c)!, gn);
  };

  const roots = v.order.filter((id) => v.nodes.get(id)!.parent === null);
  for (const id of roots) {
    const cw = new ChunkWriter(id);
    pending.push({ chunk: cw, role: 'system', root: id });
    emitNode(cw, built.get(id)!, null);
  }

  const chunks: ChunkInfo[] = [];
  const files: string[] = [];
  for (const p of pending) {
    const bytes = await p.chunk.write(io);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
    const file = `${p.chunk.id}.${hash}.glb`;
    writeFileSync(join(outDir, file), bytes);
    files.push(file);
    chunks.push({ id: p.chunk.id, url: `data/vehicles/${vid}/${file}`, bytes: bytes.byteLength, triangles: p.chunk.triangles, role: p.role, root: p.root });
  }

  // ---- explode vectors --------------------------------------------------------
  const explodeOf = (b: BuiltNode): Vec3 => {
    const n = b.node;
    if (n.explode) {
      const d = new THREE.Vector3(...n.explode.dir);
      if (d.lengthSq() === 0) return [0, 0, 0];
      d.normalize().multiplyScalar(n.explode.dist * MM_TO_M);
      const t = isoDirToThree([d.x, d.y, d.z]);
      return t.map((x) => Math.round(x * 1e4) / 1e4) as Vec3;
    }
    if (!n.parent) return [0, 0, 0];
    const parent = built.get(n.parent)!;
    if (!b.subtreeBox || b.subtreeBox.isEmpty() || !parent.subtreeBox || parent.subtreeBox.isEmpty()) return [0, 0, 0];
    const pc = parent.subtreeBox.getCenter(new THREE.Vector3());
    const cc = b.subtreeBox.getCenter(new THREE.Vector3());
    const R = parent.subtreeBox.getSize(new THREE.Vector3()).length() / 2;
    const off = cc.clone().sub(pc);
    let dirW = off.lengthSq() < 1 ? new THREE.Vector3(0, 0, 1) : off.clone().normalize();
    // express the world direction in the parent's frame (rotation only)
    const rot = new THREE.Matrix4().extractRotation(parent.world).invert();
    dirW = dirW.applyMatrix4(rot).normalize();
    const dist = Math.min(600, Math.max(30, 0.22 * R + 0.55 * off.length()));
    const d = dirW.multiplyScalar(dist * MM_TO_M);
    return isoDirToThree([d.x, d.y, d.z]).map((x) => Math.round(x * 1e4) / 1e4) as Vec3;
  };

  const depth = new Map<string, number>();
  const nodes: RuntimeNode[] = v.order.map((id) => {
    const b = built.get(id)!;
    const n = b.node;
    const d = n.parent ? depth.get(n.parent)! + 1 : 0;
    depth.set(id, d);
    const input = n.input;
    const size = b.ownBox ? b.ownBox.getSize(new THREE.Vector3()) : null;
    return {
      id,
      parent: n.parent,
      children: n.children,
      kind: n.kind,
      name: n.name,
      aliases: n.aliases,
      system: n.system,
      depth: d,
      ...(n.side ? { side: n.side } : {}),
      ...(input?.summary ? { summary: input.summary } : {}),
      ...(input?.function ? { function: input.function } : {}),
      ...(input?.location ? { location: input.location } : {}),
      ...(input?.access
        ? { access: { from: input.access.from, removeFirst: n.removeFirst, tools: input.access.tools, notes: input.access.notes, sources: input.access.sources } }
        : {}),
      partNumbers: (input?.partNumbers ?? []).filter((p) => !p.side || p.side === n.side).map(({ side: _s, ...rest }) => rest),
      specs: input?.specs ?? [],
      manufacturing: input?.manufacturing ?? [],
      ...(input?.fitment ? { fitment: input.fitment } : {}),
      ewd: n.ewd,
      faults: input?.faults ?? [],
      ...(input?.connector ? { connector: { ...input.connector, mates: n.mates } } : {}),
      ...(input?.harness ? { harness: { connects: n.connects } } : {}),
      ...(n.links.length ? { links: n.links } : {}),
      ...(n.ewdConnectors?.length ? { ewdConnectors: n.ewdConnectors } : {}),
      ...(n.generated ? { generated: true } : {}),
      ...(n.material ? { material: n.material } : {}),
      verification: { ...n.verification, status: verificationStatus(n.verification), score: verificationScore(n.verification) },
      explode: explodeOf(b),
      ...(b.subtreeBox && !b.subtreeBox.isEmpty() ? { bounds: box3ToThree(b.subtreeBox) } : {}),
      ...(size ? { size: [Math.round(size.x), Math.round(size.y), Math.round(size.z)] as Vec3 } : {}),
      chunk: chunkOf.get(id)!,
      ...(detailOf.has(id) ? { detailChunk: detailOf.get(id) } : {}),
      triangles: b.triangles,
    };
  });

  // ---- general descriptions for parts that have no summary of their own ---------
  const rules = (library?.descriptions ?? []).map((d) => ({ re: new RegExp(d.match, 'i'), kinds: d.kinds as string[] | undefined, text: d.text }));
  for (const n of nodes) {
    if (n.kind === 'system' || n.summary) continue;
    const name = n.name.replace(/ \((LH|RH)\)$/, '');
    const rule = rules.find((r) => r.re.test(name) && (!r.kinds || r.kinds.includes(n.kind)));
    if (rule) Object.assign(n, { summary: rule.text, summaryGeneral: true });
  }

  // ---- wiring netlists, one per publication (model year / issue) ------------------
  let wiring: Manifest['wiring'];
  const w = v.vehicle.wiring;
  if (w) {
    const mappedCodes = new Set(nodes.flatMap((n) => n.ewd));
    const notApplicable = w.notApplicable;
    const na = new Set(notApplicable.flatMap((n) => n.codes));
    // chronological: model years first, then the label
    const pubs = [{ id: w.id, file: w.file, source: w.source, label: w.label ?? w.id, years: w.years, note: undefined as string | undefined }, ...w.publications].sort(
      (a, b) => (a.years ?? '').localeCompare(b.years ?? '') || a.label.localeCompare(b.label),
    );
    const out: WiringPublication[] = [];
    let prev: { id: string; data: EwdData } | null = null;
    for (const pub of pubs) {
      const data = JSON.parse(readFileSync(join(v.dir, pub.file), 'utf8')) as EwdData;
      const isDefault = pub.id === w.id;
      const pubLayout = isDefault ? layouts?.main : layouts?.others.get(pub.id);
      // the published file carries the harness routing graph next to the netlist
      const raw = Buffer.from(JSON.stringify(pubLayout ? { ...data, layout: pubLayout } : data));
      const hash = createHash('sha256').update(raw).digest('hex').slice(0, 10);
      const file = `wiring-${pub.id}.${hash}.json`;
      writeFileSync(join(outDir, file), raw);
      files.push(file);
      const relevant = relevantEwdComponents(data, na);
      out.push({
        id: pub.id,
        label: pub.label,
        ...(pub.years ? { years: pub.years } : {}),
        ...(pub.note ? { note: pub.note } : {}),
        title: data.publication.title,
        vin: data.publication.vin,
        source: pub.source,
        url: `data/vehicles/${vid}/${file}`,
        bytes: raw.byteLength,
        stats: data.stats,
        mapped: [...relevant].filter((c) => mappedCodes.has(c)).length,
        relevant: relevant.size,
        lengths: data.wires.filter((x) => x.length).length,
        isDefault,
        ...(prev ? { changes: diffPublications(prev.id, prev.data, data) } : {}),
      });
      prev = { id: pub.id, data };
    }
    const def = out.find((p) => p.isDefault)!;
    const main = layouts?.main;
    wiring = {
      id: def.id,
      url: def.url,
      bytes: def.bytes,
      source: w.source,
      ...(w.note ? { note: w.note } : {}),
      publication: { title: def.title, vin: def.vin, market: 'LHD' },
      stats: def.stats,
      mapped: def.mapped,
      relevant: def.relevant,
      notApplicable,
      publications: out,
      ...(w.lengths ? { lengthsSource: w.lengths.source } : {}),
      ...(main
        ? {
            layout: {
              vertices: main.v.length / 3,
              junctions: main.virtual.filter((x) => x).length,
              branches: nodes.filter((n) => n.generated && n.kind === 'harness').length,
              inline: nodes.filter((n) => n.generated && n.id.startsWith('inline-')).length,
              splices: Object.keys(main.splices).length,
              grounds: Object.keys(main.grounds).length,
              calculated: Object.values(main.calc ?? {}).filter((c) => c.calculated).length,
            },
          }
        : {}),
    };
  }

  const sources: Record<string, SourceInfo> = {};
  for (const [id, s] of v.sources) sources[id] = s;
  const byStatus = { verified: 0, partial: 0, unverified: 0 };
  for (const n of nodes) if (n.kind !== 'system') byStatus[n.verification.status]++;
  const veh = v.vehicle;
  const manifest: Manifest = {
    schema: MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...(wiring ? { wiring } : {}),
    vehicle: {
      id: veh.id,
      make: veh.make,
      model: veh.model,
      generation: veh.generation,
      modelYear: veh.modelYear,
      variant: veh.variant,
      aliases: veh.aliases,
      specs: veh.specs,
      envelope: {
        length: veh.envelope.length,
        width: veh.envelope.width,
        height: veh.envelope.height,
        wheelbase: veh.envelope.wheelbase,
        trackFront: veh.envelope.trackFront,
        trackRear: veh.envelope.trackRear,
      },
      frame: { axes: 'ISO 8855 (+X forward, +Y left, +Z up)', origin: 'Ground plane, vehicle centreline, front axle', units: 'mm' },
      disclaimer: veh.disclaimer,
      bodyColor: veh.bodyColor,
    },
    systems: veh.systems.map((s) => ({ id: s.id, name: s.name, short: s.short, color: s.color, icon: s.icon, layer: s.layer, summary: s.summary, chunk: s.id })),
    nodes,
    chunks,
    sources,
    approaches: veh.approaches.map((a) => ({ id: a.id, label: a.label, dir: isoDirToThree(a.dir) })),
    zones: veh.zones,
    checks,
    stats: {
      nodes: nodes.length,
      parts: nodes.filter((n) => n.kind === 'part' || n.kind === 'fastener').length,
      connectors: nodes.filter((n) => n.kind === 'connector').length,
      lines: nodes.filter((n) => n.kind === 'harness' || n.kind === 'hose' || n.kind === 'pipe').length,
      triangles: chunks.filter((c) => c.role === 'system').reduce((a, c) => a + c.triangles, 0),
      bytes: chunks.filter((c) => c.role === 'system').reduce((a, c) => a + c.bytes, 0),
      byStatus,
    },
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
  files.push('manifest.json');
  return { manifest, files };
}

/**
 * EWD components relevant to a diesel variant: everything except components
 * that appear only on petrol-engine sheets (the publication covers both) and
 * those the vehicle file lists as not applicable (other gearbox or market).
 */
export function relevantEwdComponents(data: EwdData, notApplicable: Set<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const [code, c] of Object.entries(data.components)) {
    if (notApplicable.has(code)) continue;
    const sheets = c.circuits;
    // service issues name sheets "303-14 Petrol 01/05"; engineering issues "ENGINE MANAGEMENT PETROL CIRCUIT"
    if (sheets.length && sheets.every((s) => /\bpetrol\b|\bP6\b/i.test(s))) continue;
    out.add(code);
  }
  return out;
}

/**
 * What changed between two issues of the wiring diagrams: components added or removed, and connections
 * (a wire between two ends) added, removed or with a different colour or cross-section. Connections are
 * compared by their ends, because the earliest issue prints most wires without an id.
 */
export function diffPublications(fromId: string, a: EwdData, b: EwdData): PublicationChanges {
  const codesA = new Set(Object.keys(a.components));
  const codesB = new Set(Object.keys(b.components));
  const conn = (d: EwdData) => new Map(d.wires.filter((x) => x.ends.length === 2).map((x) => [[...x.ends].sort().join('~'), x]));
  const A = conn(a);
  const B = conn(b);
  const examples: PublicationChanges['examples'] = [];
  const added = [...B].filter(([k]) => !A.has(k));
  const removed = [...A].filter(([k]) => !B.has(k));
  const changed = [...B].filter(([k, x]) => A.has(k) && (A.get(k)!.colour !== x.colour || A.get(k)!.csa !== x.csa));
  for (const [, x] of added.slice(0, 25)) examples.push({ kind: 'added', ends: x.ends, wire: `${x.colour} ${x.csa} mm²`, sheet: x.sheets[0] });
  for (const [, x] of removed.slice(0, 25)) examples.push({ kind: 'removed', ends: x.ends, wire: `${x.colour} ${x.csa} mm²`, sheet: x.sheets[0] });
  for (const [k, x] of changed.slice(0, 25))
    examples.push({ kind: 'changed', ends: x.ends, wire: `${x.colour} ${x.csa} mm²`, was: `${A.get(k)!.colour} ${A.get(k)!.csa} mm²`, sheet: x.sheets[0] });
  return {
    from: fromId,
    componentsAdded: [...codesB].filter((c) => !codesA.has(c)).map((c) => ({ code: c, name: b.components[c].name })),
    componentsRemoved: [...codesA].filter((c) => !codesB.has(c)).map((c) => ({ code: c, name: a.components[c].name })),
    connectionsAdded: added.length,
    connectionsRemoved: removed.length,
    connectionsChanged: changed.length,
    examples,
  };
}
