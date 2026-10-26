/**
 * Derived links: joins the build can see in the model itself, added next to
 * the documented joints (joints.yaml). A hose or pipe is linked to the part
 * each of its ends meets; a mechanical cable likewise. These carry
 * `evidence: "derived"` so the UI never presents them as documented.
 */
import * as THREE from 'three';
import type { LinkInfo, LinkType } from '../../src/shared/manifest';
import type { BuiltNode } from './assemble';
import type { LoadedVehicle, ResolvedNode } from './load';

/** A line end within this distance of a part's bounds meets that part (mm). */
const MEET = 12;
/** Two line ends this close form a union (brake pipe to flexible hose). */
const UNION = 30;
const SKIP_SYSTEMS = new Set(['body', 'structure']);
/** Rotating or sprung parts: no hose, pipe or cable ends on them. */
const NEVER_TARGET = new Set(['propshaft', 'driveshaft', 'tyre', 'rim', 'coil-spring', 'brake-disc']);
/** Trim that lines pass through rather than attach to. */
const PASS_THROUGH = new Set(['centre-console', 'dashboard']);
const EXHAUST = /exhaust|silencer|particulate|catalytic|turbine/;

/** What a line carries, from its id: unions only join lines carrying the same thing. */
function family(id: string): string | null {
  // the clutch hydraulics run on brake fluid from the brake reservoir
  if (/brake|clutch/.test(id)) return 'hydraulic';
  if (/fuel/.test(id)) return 'fuel';
  if (/radiator|heater|coolant/.test(id)) return 'coolant';
  if (/^ac-|a-c/.test(id)) return 'refrigerant';
  if (/power-steering/.test(id)) return 'steering';
  if (/charge|air|intake/.test(id)) return 'air';
  if (EXHAUST.test(id)) return 'exhaust';
  return null;
}

/** What a part handles, from its id; a fluid line only ends on a part of its own family (or an unknown one). */
function partFamily(id: string): string | null {
  if (/^ac-|expansion-valve|receiver-drier|condenser|evaporator/.test(id)) return 'refrigerant';
  if (/actuator|sensor|switch|chra|anti-roll|drop-link|-arm$|-link|knuckle|strut|damper|spring|subframe/.test(id)) return 'device';
  if (/brake|caliper|master-cylinder|abs-|clutch/.test(id)) return 'hydraulic';
  if (/injector|fuel/.test(id)) return 'fuel';
  if (/radiator|thermostat|coolant|heater|egr-cooler/.test(id)) return 'coolant';
  if (/charge-air|throttle|intake|air-cleaner|maf|compressor-housing|turbocharger/.test(id)) return 'air';
  if (/steering/.test(id)) return 'steering';
  return null;
}

type Pts = [number, number, number][];

/** End points (world, mm) of every routed run in a line node: a tube, or the tubes of a compound. */
function runEnds(b: BuiltNode): THREE.Vector3[] {
  const n = b.node;
  const g = n.input?.geometry as { gen?: string; points?: Pts; parts?: { gen: string; points?: Pts; pos?: unknown; rot?: unknown }[] } | undefined;
  const runs: Pts[] = [];
  if (g?.gen === 'tube' && g.points) runs.push(g.points);
  if (g?.gen === 'compound') for (const p of g.parts ?? []) if (p.gen === 'tube' && p.points && !p.pos && !p.rot) runs.push(p.points);
  return runs
    .filter((r) => r.length >= 2)
    .flatMap((r) => [r[0], r[r.length - 1]])
    .map((p) => new THREE.Vector3(p[0], n.mirrored ? -p[1] : p[1], p[2]).applyMatrix4(b.world));
}

export function deriveLinks(v: LoadedVehicle, built: Map<string, BuiltNode>): number {
  const nodes = v.nodes;
  const related = (a: string, b: string) => {
    for (let id: string | null = a; id; id = nodes.get(id)!.parent) if (id === b) return true;
    for (let id: string | null = b; id; id = nodes.get(id)!.parent) if (id === a) return true;
    return false;
  };
  const lineType = (n: ResolvedNode): LinkType | null =>
    n.kind === 'hose' ? 'hose' : n.kind === 'pipe' ? 'pipe' : n.kind === 'harness' && n.system !== 'electrical' && !n.connects.length ? 'cable' : null;
  const solids = [...built.values()].filter(
    (b) =>
      b.worldBox &&
      !b.worldBox.isEmpty() &&
      !['harness', 'hose', 'pipe', 'connector'].includes(b.node.kind) &&
      !SKIP_SYSTEMS.has(b.node.system) &&
      !PASS_THROUGH.has(b.node.baseId) &&
      !NEVER_TARGET.has((b.node.input?.geometry as { gen?: string } | undefined)?.gen ?? ''),
  );
  const add = (n: ResolvedNode, link: LinkInfo) => {
    if (!n.links.some((l) => l.to === link.to)) n.links.push(link);
  };
  const lines = [...built.values()].flatMap((b) => {
    const type = lineType(b.node);
    return type ? [{ b, type, ends: runEnds(b) }] : [];
  });
  let count = 0;
  for (const { b, type, ends } of lines) {
    const n = b.node;
    // ends already covered by a documented joint need no guess
    const documented = n.links.filter((l) => l.evidence === 'authored').map((l) => built.get(l.to)?.subtreeBox).filter((x): x is THREE.Box3 => !!x);
    ends.forEach((end, k) => {
      if (documented.some((box) => box.distanceToPoint(end) <= 2 * MEET)) return;
      const which = k % 2 === 0 ? 'One' : 'Other';
      // a pipe-to-hose union carrying the same fluid takes precedence over the part behind it
      const fam = family(n.baseId);
      const union =
        type === 'cable' || !fam
          ? undefined
          : lines.find(
              (o) =>
                o.b !== b &&
                o.type !== type &&
                o.type !== 'cable' &&
                family(o.b.node.baseId) === fam &&
                !related(o.b.node.id, n.id) &&
                o.ends.some((e) => e.distanceTo(end) <= UNION),
            );
      if (union) {
        add(n, { to: union.b.node.id, type, evidence: 'derived', note: `${which} end joins the ${union.b.node.name} in the model` });
        add(union.b.node, { to: n.id, type, evidence: 'derived', note: `Joins the ${n.name} in the model` });
        count++;
        return;
      }
      let best: { b: BuiltNode; d: number; vol: number } | null = null;
      for (const s of solids) {
        if (related(s.node.id, n.id)) continue;
        // only exhaust runs end on exhaust parts; fluid lines end on parts handling the same fluid
        if (fam !== 'exhaust' && EXHAUST.test(s.node.baseId)) continue;
        const pf = partFamily(s.node.baseId);
        if (type !== 'cable' && fam && pf && pf !== fam) continue;
        const d = s.worldBox!.distanceToPoint(end);
        if (d > MEET) continue;
        const size = s.worldBox!.getSize(new THREE.Vector3());
        const vol = size.x * size.y * size.z;
        // the nearest part wins; between equally near parts, the smaller (more specific) one
        if (!best || d < best.d - 1 || (Math.abs(d - best.d) <= 1 && vol < best.vol)) best = { b: s, d, vol };
      }
      if (!best) return;
      const part = best.b.node;
      add(n, { to: part.id, type, evidence: 'derived', note: `${which} end meets the ${part.name} in the model` });
      add(part, { to: n.id, type, evidence: 'derived', note: `An end of the ${n.name} meets this part in the model` });
      count++;
    });
  }
  return count;
}
