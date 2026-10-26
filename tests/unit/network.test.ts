/**
 * Electrical completeness and component links on the real dataset: every
 * wiring-diagram component that applies to this car has a part, every part is
 * wired into one harness network, wires can be routed end to end, documented
 * joints are symmetric and cited, and every part has a description.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { CheckResult, Manifest, RuntimeNode } from '../../src/shared/manifest';
import type { EwdData } from '../../src/shared/wiring';
import { buildIndex, electricalNeighbours, routeWires, wiresOfNode } from '../../src/app/wiring';
import { assemble } from '../../tools/lib/assemble';
import { runChecks } from '../../tools/lib/checks';
import { relevantEwdComponents } from '../../tools/lib/emit';
import { synthesizeHarness } from '../../tools/lib/harness';
import { deriveLinks } from '../../tools/lib/links';
import { loadVehicle } from '../../tools/lib/load';
import { DescriptionsFile } from '../../tools/lib/schema';
import { diffPublications } from '../../tools/lib/emit';

const dir = 'data/vehicles/land-rover/freelander-2/l359-2010-td4';

describe('electrical network and links (Freelander 2 dataset)', () => {
  const v = loadVehicle(dir);
  const built = assemble(v);
  const ewd = JSON.parse(readFileSync(join(dir, v.vehicle.wiring!.file), 'utf8')) as EwdData;
  const json = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as EwdData;
  const harness = synthesizeHarness(v, built, ewd, {
    lengths: json(v.vehicle.wiring!.lengths!.file),
    others: v.vehicle.wiring!.publications.map((p) => ({ id: p.id, data: json(p.file) })),
  });
  deriveLinks(v, built);
  const checks: CheckResult[] = runChecks(v, built, ewd);
  const notApplicable = new Set(v.vehicle.wiring!.notApplicable.flatMap((n) => n.codes));
  const mapped = new Set([...v.nodes.values()].flatMap((n) => n.ewd));

  it('gives every wiring-diagram component that applies to this car a 3D part', () => {
    const missing = [...relevantEwdComponents(ewd, notApplicable)].filter((c) => !mapped.has(c));
    expect(missing).toEqual([]);
  });

  it('keeps not-applicable codes real and unmapped, each with a reason', () => {
    for (const na of v.vehicle.wiring!.notApplicable) {
      expect(na.reason.length).toBeGreaterThan(20);
      for (const c of na.codes) {
        expect(ewd.components[c], c).toBeDefined();
        expect(mapped.has(c), c).toBe(false);
      }
    }
  });

  it('connects every electrical part to one harness network', () => {
    expect(harness.check.severity).toBe('info');
    expect(checks.filter((c) => c.severity === 'error')).toEqual([]);
    // the graph is a single connected network
    const L = harness.layout;
    const n = L.v.length / 3;
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < L.e.length; i += 2) {
      adj[L.e[i]].push(L.e[i + 1]);
      adj[L.e[i + 1]].push(L.e[i]);
    }
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) for (const t of adj[stack.pop()!]) if (!seen.has(t)) (seen.add(t), stack.push(t));
    expect(seen.size).toBe(n);
    // every connector of a mapped component has a position on it
    for (const node of v.nodes.values())
      for (const code of node.ewd) for (const c of ewd.components[code]?.connectors ?? []) expect(L.connectors[c], `${node.id} ${c}`).toBeDefined();
  });

  it('marks generated parts as generated, estimated or calculated from printed wire lengths', () => {
    const generated = [...v.nodes.values()].filter((n) => n.generated);
    expect(generated.length).toBeGreaterThan(100);
    for (const n of generated) {
      expect(['estimated', 'calculated']).toContain(n.verification.placement);
      expect(n.verification.sources.length).toBeGreaterThan(0);
      // a calculated position cites the publication whose lengths it was fitted to
      if (n.verification.placement === 'calculated') expect(n.verification.sources.map((s) => s.ref)).toContain(v.vehicle.wiring!.lengths!.source);
    }
    // harness branches follow estimated routes; splices and grounds are fitted to the printed lengths
    expect(generated.filter((n) => n.id.startsWith('branch-')).every((n) => n.verification.placement === 'estimated')).toBe(true);
    expect(Object.values(harness.layout.calc ?? {}).filter((c) => c.calculated).length).toBeGreaterThan(100);
  });

  it('lays out every wiring publication (model year) on the same network', () => {
    const ids = v.vehicle.wiring!.publications.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['lhd-000201', 'lhd-057872', 'lhd-09my-engineering']));
    for (const id of ids) {
      const L = harness.layouts.get(id)!;
      expect(L.v.length).toBe(harness.layout.v.length);
      expect(Object.keys(L.connectors).length).toBeGreaterThan(300);
    }
  });

  it('prefers the left-hand-drive engineering lengths for wires that cross the car', () => {
    // service issues print the right-hand-drive 1220 mm for the BJB to CJB feed; the LHD engineering issue 2130 mm
    const eng = JSON.parse(readFileSync(join(dir, v.vehicle.wiring!.lengths!.file), 'utf8')) as EwdData;
    expect(ewd.wires.find((w) => w.id === 'SBB17LA')!.length).toBe(1220);
    expect(eng.wires.find((w) => w.id === 'SBB17LA')!.length).toBe(2130);
  });

  it('routes the battery ground cable from the battery clamp to its body ground', () => {
    const manifest = { nodes: [...v.nodes.values()].map((n) => ({ id: n.id, ewd: n.ewd, ewdConnectors: n.ewdConnectors, connector: n.input?.connector })) } as unknown as Manifest;
    const ix = buildIndex({ ...ewd, layout: harness.layout }, manifest);
    const wire = ewd.wires.find((w) => w.id === 'GD108')!;
    const [route] = routeWires(ix, [wire]);
    expect(route.points.length).toBeGreaterThan(1);
    expect(route.points[0]).toEqual(harness.layout.connectors['C1D134B'].p);
    expect(route.points[route.points.length - 1]).toEqual(harness.layout.grounds['G1D108A'].p);
    // the ECM code is shared with the petrol engine: of its wires that join fitted parts, nearly all can be drawn
    const ecm = { id: 'ecm', ewd: ['D131'] } as unknown as RuntimeNode;
    const fitted = relevantEwdComponents(ewd, notApplicable);
    const onThisCar = wiresOfNode(ix, ecm).filter(
      (w) => w.ends.length === 2 && w.ends.every((e) => !/^C/.test(e) || fitted.has(ewd.connectors[e.slice(0, e.lastIndexOf('-'))]?.component ?? '')),
    );
    expect(onThisCar.length).toBeGreaterThan(20);
    expect(routeWires(ix, onThisCar).length / onThisCar.length).toBeGreaterThan(0.95);
    expect(electricalNeighbours(ix, ecm).map((x) => x.node)).toEqual(expect.arrayContaining(['injector-1', 'crank-sensor']));
  });

  it('makes documented joints symmetric and cited', () => {
    const authored = [...v.nodes.values()].flatMap((n) => n.links.filter((l) => l.evidence === 'authored').map((l) => ({ from: n.id, ...l })));
    expect(authored.length).toBeGreaterThan(200);
    for (const l of authored) {
      expect(l.source?.ref, `${l.from} → ${l.to}`).toBeTruthy();
      expect(v.nodes.get(l.to)!.links.some((b) => b.to === l.from), `${l.to} ↔ ${l.from}`).toBe(true);
    }
    // a mirrored part is joined on its own side
    expect(v.nodes.get('front-knuckle-r')!.links.map((l) => l.to)).toEqual(expect.arrayContaining(['front-caliper-carrier-r', 'front-lower-arm-r', 'tie-rod-r']));
    expect(v.nodes.get('front-knuckle-r')!.links.map((l) => l.to)).not.toContain('front-caliper-carrier-l');
  });

  it('never links a fluid line to a part carrying something else', () => {
    const derived = [...v.nodes.values()].flatMap((n) => n.links.filter((l) => l.evidence === 'derived').map((l) => [n.id, l.to]));
    expect(derived.length).toBeGreaterThan(20);
    expect(derived).not.toContainEqual(['heater-hoses', 'expansion-valve']);
    expect(derived).toContainEqual(['radiator-bottom-hose', 'coolant-pump']);
  });

  it('has a valid description library with a description for every part', () => {
    const lib = DescriptionsFile.parse(parse(readFileSync('data/library/descriptions.yaml', 'utf8')));
    const rules = lib.descriptions.map((d) => ({ re: new RegExp(d.match, 'i'), kinds: d.kinds as string[] | undefined }));
    const without = [...v.nodes.values()].filter(
      (n) => n.kind !== 'system' && !n.input?.summary && !rules.some((r) => r.re.test(n.name.replace(/ \((LH|RH)\)$/, '')) && (!r.kinds || r.kinds.includes(n.kind))),
    );
    expect(without.map((n) => n.name)).toEqual([]);
  });

  it('reports what changed between wiring publications', () => {
    const older = json(v.vehicle.wiring!.publications.find((p) => p.id === 'lhd-057872')!.file);
    const c = diffPublications('lhd-057872', older, ewd);
    expect(c.from).toBe('lhd-057872');
    expect(c.connectionsAdded + c.connectionsRemoved + c.connectionsChanged).toBeGreaterThan(0);
    expect(c.examples.length).toBeGreaterThan(0);
  });

  it('adds the door, tailgate and trim hardware with documented joints and access', () => {
    const linkTo = (a: string, b: string) => v.nodes.get(a)!.links.find((l) => l.to === b);
    expect(linkTo('rear-door-hinges-l', 'b-pillar-l')?.torque).toBe('30 Nm');
    expect(linkTo('tailgate-gas-strut-r', 'd-pillar-inner-r')?.torque).toBe('24 Nm');
    expect(v.nodes.get('rear-door-hinges-l')!.verification.placement).toBe('calculated');
    // the manual: remove the front scuff plate for the B-pillar sensor, the rear quarter trim for the C-pillar sensor
    expect(v.nodes.get('side-impact-sensor-b-pillar-l')!.removeFirst).toEqual(['front-scuff-plate-l']);
    expect(v.nodes.get('side-impact-sensor-c-pillar-r')!.removeFirst).toEqual(['rear-quarter-trim-r']);
    // door electrics split into real units, each code stored once
    expect(v.nodes.get('front-door-latch-l')!.ewd).toEqual(['M236', 'S409']);
    expect(v.nodes.get('front-door-electrics-l')!.ewd).toEqual(['D253']);
  });
});
