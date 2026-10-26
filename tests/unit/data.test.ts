/**
 * The real dataset must load, build and pass every automated check — this is
 * the gate that stops a bad edit from reaching the site.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { verificationStatus } from '../../src/shared/verification';
import { assemble } from '../../tools/lib/assemble';
import { runChecks } from '../../tools/lib/checks';
import { loadVehicle } from '../../tools/lib/load';

const dir = 'data/vehicles/land-rover/freelander-2/l359-2010-td4';

describe('Freelander 2 (L359) 2010 2.2 TD4 dataset', () => {
  const v = loadVehicle(dir);
  const built = assemble(v);
  const checks = runChecks(v, built);

  it('passes every automated geometry check', () => {
    const problems = checks.filter((c) => c.severity !== 'info');
    expect(problems.map((c) => `${c.title}\n${c.detail ?? ''}`)).toEqual([]);
  });

  it('expands mirrored pairs with mirrored placement', () => {
    const l = v.nodes.get('front-strut-l')!;
    const r = v.nodes.get('front-strut-r')!;
    expect(r.pos[1]).toBe(-l.pos[1]);
    expect(r.rot).toEqual([-l.rot[0], l.rot[1], -l.rot[2]]);
    expect(r.mirrored).toBe(true);
  });

  it('resolves side-relative references to the same side', () => {
    expect(v.nodes.get('front-brake-disc-r')!.removeFirst).toEqual(['wheel-front-r', 'front-caliper-r']);
    expect(v.nodes.get('arch-liner-front-r')!.input!.location!.zone).toBe('wheel-arch-front-right');
  });

  it('never marks a component verified without a reviewer', () => {
    for (const n of v.nodes.values()) if (n.verification.reviews.length === 0) expect(verificationStatus(n.verification)).not.toBe('verified');
  });

  it('is a left-hand-drive car: driver controls on the left (+Y), passenger items on the right', () => {
    const y = (id: string) => new THREE.Vector3().setFromMatrixPosition(built.get(id)!.world).y;
    expect(v.vehicle.variant.steering).toBe('left');
    expect(y('steering-wheel')).toBeGreaterThan(200);
    expect(y('brake-booster') > 0 || built.get('brake-booster')!.worldBox!.getCenter(new THREE.Vector3()).y > 0).toBe(true);
    expect(built.get('cjb-body')!.worldBox!.getCenter(new THREE.Vector3()).y).toBeLessThan(-200);
    expect(built.get('glovebox')!.worldBox!.getCenter(new THREE.Vector3()).y).toBeLessThan(-200);
  });

  it('numbers cylinders from the gearbox end, as the manual does', () => {
    const y = (id: string) => new THREE.Vector3().setFromMatrixPosition(built.get(id)!.world).y;
    // gearbox on the vehicle's left (+Y): cylinder 1 must be further left than cylinder 4
    expect(y('injector-1')).toBeGreaterThan(y('injector-4'));
  });

  it('is a manual car with no automatic-transmission parts left behind', () => {
    expect(v.nodes.get('gearbox')!.name).toMatch(/M66/);
    for (const id of ['tcm', 'flexplate', 'gear-selector', 'transmission-fluid-cooler']) expect(v.nodes.has(id)).toBe(false);
    expect(v.nodes.has('clutch-pedal')).toBe(true);
    expect(v.nodes.has('dual-mass-flywheel')).toBe(true);
  });

  it('passes every check including duplicates and wiring cross-references', () => {
    const ewd = JSON.parse(readFileSync(join(dir, v.vehicle.wiring!.file), 'utf8'));
    const all = runChecks(v, built, ewd);
    expect(all.filter((c) => c.severity !== 'info').map((c) => `${c.title}\n${c.detail ?? ''}`)).toEqual([]);
    expect(all.find((c) => c.id === 'ewd-coverage')!.title).toMatch(/of \d+ electrical components/);
  });

  it('cites a source for every fact above "unsourced"', () => {
    for (const n of v.nodes.values()) if (n.verification.facts !== 'unsourced') expect(n.verification.sources.length).toBeGreaterThan(0);
  });

  it('gives every harness at least one endpoint and every connector a parent part', () => {
    for (const n of v.nodes.values()) {
      if (n.kind === 'harness') expect(n.connects.length + (n.input?.harness ? 0 : 1)).toBeGreaterThan(0);
      if (n.kind === 'connector') expect(n.parent).not.toBeNull();
    }
  });
});
