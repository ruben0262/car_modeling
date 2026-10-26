/**
 * Loads one vehicle directory: validates every YAML file, builds the
 * component tree, expands mirrored left/right pairs and resolves
 * cross-references. Throws a DataError listing *all* problems found.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import type { Vec3 } from '../../src/shared/frames';
import type { LinkInfo, NodeKind, Side } from '../../src/shared/manifest';
import type { VerificationFacets } from '../../src/shared/verification';
import {
  ComponentFile,
  JointsFile,
  SourcesFile,
  VehicleFile,
  type NodeInputT,
  type SourceInputT,
  type VehicleFileT,
  type VerificationInputT,
} from './schema';

export class DataError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`${problems.length} data problem(s):\n  - ${problems.join('\n  - ')}`);
    this.problems = problems;
  }
}

export interface ResolvedNode {
  id: string;
  /** Authored id before left/right expansion (shared by both sides). */
  baseId: string;
  parent: string | null;
  children: string[];
  kind: NodeKind;
  name: string;
  aliases: string[];
  system: string;
  side?: Side;
  /** True for the right-hand copy of a mirrored subtree: geometry and placement are reflected in Y. */
  mirrored: boolean;
  input: NodeInputT | null;
  pos: Vec3;
  rot: Vec3;
  explode?: { dir: Vec3; dist: number };
  material?: string;
  verification: VerificationFacets;
  removeFirst: string[];
  contacts: string[];
  mates?: string;
  connects: string[];
  /** EWD component codes after side resolution. */
  ewd: string[];
  /** Authored links with resolved target ids. */
  links: LinkInfo[];
  /** Wiring-diagram connector ids carried by a generated node. */
  ewdConnectors?: string[];
  /** Created by the build (harness branches, in-line connectors, ground points). */
  generated?: boolean;
  file: string;
}

export interface LoadedVehicle {
  dir: string;
  vehicle: VehicleFileT;
  sources: Map<string, SourceInputT>;
  nodes: Map<string, ResolvedNode>;
  /** Depth-first order, parents before children. */
  order: string[];
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'), { prettyErrors: true });
}

function zodProblems(file: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${file}: ${i.path.join('.') || '(root)'}: ${i.message}`);
}

const SIDE_SUFFIX: Record<Side, string> = { left: 'l', right: 'r' };

function mirrorVec(v: Vec3): Vec3 {
  return [v[0], -v[1], v[2]];
}

/** Reflection across the XZ plane conjugates rotations: (rx, ry, rz) → (−rx, ry, −rz). */
function mirrorRot(r: Vec3): Vec3 {
  return [-r[0], r[1], -r[2]];
}

export function resolveVerification(
  defaults: VerificationInputT | undefined,
  own: VerificationInputT | undefined,
): VerificationFacets {
  return {
    geometry: own?.geometry ?? defaults?.geometry ?? 'placeholder',
    placement: own?.placement ?? defaults?.placement ?? 'estimated',
    facts: own?.facts ?? defaults?.facts ?? 'unsourced',
    sources: [...(defaults?.sources ?? []), ...(own?.sources ?? [])],
    reviews: [...(defaults?.reviews ?? []), ...(own?.reviews ?? [])],
    notes: own?.notes ?? defaults?.notes,
  };
}

export function loadVehicle(dir: string, root = process.cwd()): LoadedVehicle {
  const problems: string[] = [];
  const rel = (p: string) => relative(root, p);

  const vehiclePath = join(dir, 'vehicle.yaml');
  const vParsed = VehicleFile.safeParse(readYaml(vehiclePath));
  if (!vParsed.success) throw new DataError(zodProblems(rel(vehiclePath), vParsed.error));
  const vehicle = vParsed.data;

  const sources = new Map<string, SourceInputT>();
  const sourcesPath = join(dir, 'sources.yaml');
  if (existsSync(sourcesPath)) {
    const sParsed = SourcesFile.safeParse(readYaml(sourcesPath));
    if (!sParsed.success) problems.push(...zodProblems(rel(sourcesPath), sParsed.error));
    else
      for (const s of sParsed.data.sources) {
        if (sources.has(s.id)) problems.push(`${rel(sourcesPath)}: duplicate source id "${s.id}"`);
        sources.set(s.id, s);
      }
  }

  // ---- collect authored nodes -------------------------------------------------
  interface Authored {
    input: NodeInputT;
    system: string;
    file: string;
    defaults: { verification?: VerificationInputT; material?: string };
  }
  const authored = new Map<string, Authored>();
  const systemIds = new Set(vehicle.systems.map((s) => s.id));

  for (const f of vehicle.files) {
    const path = join(dir, f);
    if (!existsSync(path)) {
      problems.push(`${rel(vehiclePath)}: listed file "${f}" does not exist`);
      continue;
    }
    const parsed = ComponentFile.safeParse(readYaml(path));
    if (!parsed.success) {
      problems.push(...zodProblems(rel(path), parsed.error));
      continue;
    }
    const cf = parsed.data;
    if (!systemIds.has(cf.system)) problems.push(`${rel(path)}: unknown system "${cf.system}"`);
    for (const n of cf.nodes) {
      if (authored.has(n.id) || systemIds.has(n.id)) problems.push(`${rel(path)}: duplicate id "${n.id}"`);
      if (n.sides && (n.sides.length !== 2 || !n.sides.includes('left') || !n.sides.includes('right')))
        problems.push(`${rel(path)}: "${n.id}": sides must be [left, right] (author the left/+Y copy; the right is mirrored)`);
      authored.set(n.id, { input: n, system: cf.system, file: rel(path), defaults: cf.defaults });
    }
  }

  // ---- tree (authored ids) ----------------------------------------------------
  const authoredChildren = new Map<string, string[]>();
  for (const id of systemIds) authoredChildren.set(id, []);
  for (const [id, a] of authored) {
    const parent = a.input.parent ?? a.system;
    if (!authored.has(parent) && !systemIds.has(parent)) {
      problems.push(`${a.file}: "${id}" has unknown parent "${parent}"`);
      continue;
    }
    if (!authoredChildren.has(parent)) authoredChildren.set(parent, []);
    authoredChildren.get(parent)!.push(id);
  }

  // ---- expand ----------------------------------------------------------------
  const nodes = new Map<string, ResolvedNode>();
  const order: string[] = [];
  /** authored id → expanded ids (one, or one per side) */
  const expansions = new Map<string, Partial<Record<Side | 'single', string>>>();

  const steeringRight = vehicle.variant.steering === 'right';
  const visit = (authoredId: string, parentId: string | null, side: Side | undefined, depth: number, trail: Set<string>, handedFlip = false) => {
    if (trail.has(authoredId)) {
      problems.push(`cycle in parent chain at "${authoredId}"`);
      return;
    }
    const a = authored.get(authoredId);
    const isSystem = !a;
    const sidesHere: (Side | undefined)[] = a?.input.sides ? (side ? [] : ['left', 'right']) : [side];
    if (a?.input.sides && side) {
      problems.push(`${a.file}: "${authoredId}" declares sides inside an already mirrored subtree`);
      return;
    }
    // handed parts are authored for left-hand drive and mirrored for right-hand drive
    const flip = handedFlip || (!!a?.input.handed && steeringRight);
    for (const s of sidesHere) {
      const id = s && (a?.input.sides || side) ? `${authoredId}-${SIDE_SUFFIX[s]}` : authoredId;
      if (nodes.has(id)) {
        problems.push(`expanded id "${id}" collides with an existing id`);
        continue;
      }
      const mirrored = (s === 'right') !== flip;
      const input = a?.input ?? null;
      const sysDef = vehicle.systems.find((x) => x.id === authoredId);
      const placement = input?.placement ?? { pos: [0, 0, 0] as Vec3, rot: [0, 0, 0] as Vec3 };
      const explode = input?.explode ?? (sysDef ? sysDef.explode : undefined);
      const node: ResolvedNode = {
        id,
        baseId: authoredId,
        parent: parentId,
        children: [],
        kind: isSystem ? 'system' : input!.kind,
        name: isSystem
          ? sysDef!.name
          : s && (a?.input.sides || side)
            ? `${input!.name} (${s === 'left' ? 'LH' : 'RH'})`
            : input!.name,
        aliases: input?.aliases ?? [],
        system: isSystem ? authoredId : a!.system,
        side: s,
        mirrored,
        input,
        pos: mirrored ? mirrorVec(placement.pos) : placement.pos,
        rot: mirrored ? mirrorRot(placement.rot) : placement.rot,
        explode: explode ? { dir: mirrored ? mirrorVec(explode.dir) : explode.dir, dist: explode.dist } : undefined,
        material: input?.material ?? a?.defaults.material,
        verification: resolveVerification(isSystem ? undefined : a!.defaults.verification, input?.verification),
        removeFirst: [],
        contacts: [],
        connects: [],
        links: [],
        ewd: (input?.ewd ?? [])
          .filter((c) => !c.includes(':') || c.endsWith(`:${s === 'right' ? 'r' : 'l'}`) || !s)
          .map((c) => c.replace(/:[lr]$/, '')),
        file: a?.file ?? rel(vehiclePath),
      };
      nodes.set(id, node);
      order.push(id);
      const exp = expansions.get(authoredId) ?? {};
      exp[s ?? 'single'] = id;
      expansions.set(authoredId, exp);
      if (parentId) nodes.get(parentId)!.children.push(id);
      const nextTrail = new Set(trail).add(authoredId);
      for (const child of authoredChildren.get(authoredId) ?? []) visit(child, id, s, depth + 1, nextTrail, flip);
    }
  };
  for (const sys of vehicle.systems) visit(sys.id, null, undefined, 0, new Set());

  for (const id of authored.keys()) if (!expansions.has(id)) problems.push(`"${id}" is not reachable from any system`);

  // ---- resolve references -------------------------------------------------------
  const resolveRef = (from: ResolvedNode, ref: string, what: string): string | null => {
    if (nodes.has(ref)) return ref;
    const exp = expansions.get(ref);
    if (exp) {
      if (exp.single) return exp.single;
      if (from.side && exp[from.side]) return exp[from.side]!;
      problems.push(`${from.file}: "${from.id}" ${what} "${ref}" is mirrored — use "${ref}-l" or "${ref}-r"`);
      return null;
    }
    problems.push(`${from.file}: "${from.id}" ${what} unknown id "${ref}"`);
    return null;
  };
  const zones = new Set(Object.keys(vehicle.zones));
  const approaches = new Set(vehicle.approaches.map((a) => a.id));
  const checkSources = (n: ResolvedNode, refs: { ref: string }[] | undefined, what: string) => {
    for (const r of refs ?? []) if (!sources.has(r.ref)) problems.push(`${n.file}: "${n.id}" ${what} cites unknown source "${r.ref}"`);
  };

  // Side-specific zone/approach ids follow the mirrored copy (…-left → …-right).
  const sideId = (n: ResolvedNode, id: string) => (n.side === 'right' ? id.replace(/-left$/, '-right') : id);

  for (const n of nodes.values()) {
    const input = n.input;
    if (!input) continue;
    if (n.side === 'right' && (input.location || input.access)) {
      n.input = {
        ...input,
        location: input.location ? { ...input.location, zone: sideId(n, input.location.zone) } : undefined,
        access: input.access ? { ...input.access, from: input.access.from.map((a) => sideId(n, a)) } : undefined,
      };
    }
    n.removeFirst = (input.access?.removeFirst ?? []).map((r) => resolveRef(n, r, 'access.removeFirst')).filter((x): x is string => !!x);
    n.contacts = input.contacts.map((r) => resolveRef(n, r, 'contacts')).filter((x): x is string => !!x);
    if (input.connector?.mates) n.mates = resolveRef(n, input.connector.mates, 'connector.mates') ?? undefined;
    n.connects = (input.harness?.connects ?? []).map((r) => resolveRef(n, r, 'harness.connects')).filter((x): x is string => !!x);
    n.links = input.links.flatMap((l) => {
      const to = resolveRef(n, l.to, 'links');
      return to ? [{ ...l, to, evidence: 'authored' as const }] : [];
    });
    if (n.links.some((l) => l.to === n.id)) problems.push(`${n.file}: "${n.id}" links to itself`);
    checkSources(n, input.links.flatMap((l) => (l.source ? [l.source] : [])), 'link');
    const loc = n.input!.location;
    if (loc && !zones.has(loc.zone)) problems.push(`${n.file}: "${n.id}" unknown zone "${loc.zone}"`);
    for (const ap of n.input!.access?.from ?? []) if (!approaches.has(ap)) problems.push(`${n.file}: "${n.id}" unknown access approach "${ap}"`);
    if (n.removeFirst.includes(n.id)) problems.push(`${n.file}: "${n.id}" lists itself in removeFirst`);
    checkSources(n, n.verification.sources, 'verification');
    checkSources(n, input.access?.sources, 'access');
    checkSources(n, input.partNumbers.flatMap((p) => (p.source ? [p.source] : [])), 'part number');
    checkSources(n, input.specs.flatMap((p) => (p.source ? [p.source] : [])), 'spec');
    checkSources(n, input.manufacturing.flatMap((p) => (p.source ? [p.source] : [])), 'manufacturing');
    if (!n.side && input.ewd.some((c) => c.includes(':'))) problems.push(`${n.file}: "${n.id}" uses side-suffixed EWD codes but is not mirrored`);
    checkSources(n, input.faults.flatMap((p) => (p.source ? [p.source] : [])), 'fault');
    if ((input.kind === 'harness' || input.kind === 'hose' || input.kind === 'pipe') && !input.geometry)
      problems.push(`${n.file}: "${n.id}" is a ${input.kind} without a routed path (geometry)`);
    if (n.verification.facts !== 'unsourced' && n.verification.sources.length === 0)
      problems.push(`${n.file}: "${n.id}" claims facts "${n.verification.facts}" but cites no sources`);
    if (n.verification.facts === 'oem') {
      const oem = n.verification.sources.some((s) => sources.get(s.ref)?.type.startsWith('oem'));
      if (!oem) problems.push(`${n.file}: "${n.id}" claims OEM-level facts without an OEM source`);
    }
  }
  // ---- documented joints: each becomes a link on both parts, per side for mirrored parts ------------
  if (vehicle.joints) {
    const path = join(dir, vehicle.joints);
    const parsed = existsSync(path) ? JointsFile.safeParse(readYaml(path)) : null;
    if (!parsed) problems.push(`vehicle.yaml: joints file "${vehicle.joints}" does not exist`);
    else if (!parsed.success) problems.push(...zodProblems(rel(path), parsed.error));
    else {
      const seen = new Set<string>();
      const sided = (ref: string): Partial<Record<Side | 'single', string>> | null => (nodes.has(ref) ? { single: ref } : (expansions.get(ref) ?? null));
      for (const j of parsed.data.joints) {
        const where = `${rel(path)}: joint ${j.a} ↔ ${j.b}`;
        if (!sources.has(j.source.ref)) problems.push(`${where} cites unknown source "${j.source.ref}"`);
        const A = sided(j.a);
        const B = sided(j.b);
        if (!A || !B) {
          problems.push(`${where}: unknown id "${!A ? j.a : j.b}"`);
          continue;
        }
        const pairs: [string, string][] = [];
        for (const s of ['left', 'right'] as const)
          if ((A[s] || B[s]) && (A[s] ?? A.single) && (B[s] ?? B.single)) pairs.push([(A[s] ?? A.single)!, (B[s] ?? B.single)!]);
        if (!pairs.length && A.single && B.single) pairs.push([A.single, B.single]);
        if (!pairs.length) problems.push(`${where}: cannot pair sides`);
        for (const [a, b] of pairs) {
          const key = [a, b].sort().join('|');
          if (a === b) problems.push(`${where}: joins a part to itself`);
          if (seen.has(key)) problems.push(`${where}: duplicate joint`);
          seen.add(key);
          const link = { type: j.type, evidence: 'authored' as const, ...(j.torque ? { torque: j.torque } : {}), ...(j.note ? { note: j.note } : {}), source: j.source };
          nodes.get(a)!.links.push({ to: b, ...link });
          nodes.get(b)!.links.push({ to: a, ...link });
        }
      }
    }
  }
  for (const s of vehicle.specSources) if (!sources.has(s.ref)) problems.push(`vehicle.yaml: spec source "${s.ref}" unknown`);
  if (vehicle.wiring && !sources.has(vehicle.wiring.source)) problems.push(`vehicle.yaml: wiring source "${vehicle.wiring.source}" unknown`);
  if (vehicle.wiring && !existsSync(join(dir, vehicle.wiring.file))) problems.push(`vehicle.yaml: wiring file "${vehicle.wiring.file}" does not exist`);
  for (const pub of [...(vehicle.wiring?.publications ?? []), ...(vehicle.wiring?.lengths ? [{ id: 'lengths', ...vehicle.wiring.lengths }] : [])]) {
    if (!sources.has(pub.source)) problems.push(`vehicle.yaml: wiring publication "${pub.id}" cites unknown source "${pub.source}"`);
    if (!existsSync(join(dir, pub.file))) problems.push(`vehicle.yaml: wiring publication "${pub.id}" file "${pub.file}" does not exist`);
  }
  for (const na of vehicle.wiring?.notApplicable ?? [])
    if (na.source && !sources.has(na.source.ref)) problems.push(`vehicle.yaml: wiring.notApplicable cites unknown source "${na.source.ref}"`);
  for (const s of vehicle.specs) if (s.source && !sources.has(s.source.ref)) problems.push(`vehicle.yaml: spec "${s.label}" cites unknown source "${s.source.ref}"`);

  if (problems.length) throw new DataError(problems);
  return { dir, vehicle, sources, nodes, order };
}
