import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataError, loadVehicle } from '../../tools/lib/load';

function fixture(nodes: string, steering: 'left' | 'right' = 'left'): string {
  const dir = mkdtempSync(join(tmpdir(), 'va-'));
  writeFileSync(
    join(dir, 'vehicle.yaml'),
    `id: test-car
make: Test
model: Car
generation: { code: T1, years: [2000, 2001] }
modelYear: 2000
variant: { name: base, engine: e, transmission: t, drive: d, body: b, market: m, steering: ${steering} }
disclaimer: test
bodyColor: '#888888'
envelope: { length: 4000, width: 1800, height: 1500, wheelbase: 2500, trackFront: 1500, trackRear: 1500, xFront: 800, xRear: -3200 }
systems:
  - { id: chassis, name: Chassis, short: C, color: '#ffffff', icon: cog, layer: 1, summary: s, explode: { dir: [0, 0, 1], dist: 100 } }
zones: { arch-front-left: Front left arch, arch-front-right: Front right arch }
approaches: [{ id: wheel-arch-front-left, label: FL arch, dir: [0, 1, 0] }, { id: wheel-arch-front-right, label: FR arch, dir: [0, -1, 0] }]
files: [chassis.yaml]
`,
  );
  writeFileSync(join(dir, 'chassis.yaml'), `system: chassis\nnodes:\n${nodes}`);
  return dir;
}

describe('loader', () => {
  it('expands sides, mirrors placement and renames side-specific zones/approaches', () => {
    const v = loadVehicle(
      fixture(`  - id: corner
    kind: assembly
    sides: [left, right]
    name: Corner
    location: { zone: arch-front-left, text: x }
    access: { from: [wheel-arch-front-left] }
    placement: { pos: [0, 800, 300], rot: [10, 5, 20] }
  - { id: disc, parent: corner, kind: part, name: Disc, placement: { pos: [0, 30, 0] } }
  - { id: pad, parent: corner, kind: part, name: Pad, access: { from: [wheel-arch-front-left], removeFirst: [disc] } }
`),
      '/',
    );
    expect([...v.nodes.keys()].sort()).toEqual(['chassis', 'corner-l', 'corner-r', 'disc-l', 'disc-r', 'pad-l', 'pad-r']);
    expect(v.nodes.get('corner-r')!.pos).toEqual([0, -800, 300]);
    expect(v.nodes.get('corner-r')!.rot).toEqual([-10, 5, -20]);
    expect(v.nodes.get('disc-r')!.pos).toEqual([0, -30, 0]);
    expect(v.nodes.get('pad-r')!.removeFirst).toEqual(['disc-r']);
    expect(v.nodes.get('corner-l')!.name).toBe('Corner (LH)');
    expect(v.nodes.get('corner-r')!.input!.location!.zone).toBe('arch-front-right');
    expect(v.nodes.get('pad-r')!.input!.access!.from).toEqual(['wheel-arch-front-right']);
  });

  it('reports every problem at once', () => {
    try {
      loadVehicle(
        fixture(`  - { id: a, kind: part, name: A, parent: nope }
  - { id: b, kind: part, name: B, verification: { facts: secondary } }
  - { id: c, kind: harness, name: C }
`),
        '/',
      );
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      const msgs = (e as DataError).problems.join('\n');
      expect(msgs).toMatch(/unknown parent "nope"/);
      expect(msgs).toMatch(/claims facts "secondary" but cites no sources/);
      expect(msgs).toMatch(/harness without a routed path/);
    }
  });

  it('rejects mirrored ids referenced without a side from an unsided node', () => {
    expect(() =>
      loadVehicle(
        fixture(`  - { id: corner, kind: part, sides: [left, right], name: Corner }
  - { id: other, kind: part, name: Other, contacts: [corner] }
`),
        '/',
      ),
    ).toThrow(/mirrored — use "corner-l" or "corner-r"/);
  });

  it('mirrors handed parts for a right-hand-drive variant', () => {
    const nodes = `  - { id: pedal, kind: part, name: Pedal, handed: true, placement: { pos: [-600, 400, 800], rot: [0, 0, 30] } }
  - { id: pad, parent: pedal, kind: part, name: Pad, placement: { pos: [0, 50, 0] } }
  - { id: centre, kind: part, name: Centre, placement: { pos: [0, 120, 0] } }
`;
    const lhd = loadVehicle(fixture(nodes), '/');
    expect(lhd.nodes.get('pedal')!.pos).toEqual([-600, 400, 800]);
    expect(lhd.nodes.get('pedal')!.mirrored).toBe(false);
    const rhd = loadVehicle(fixture(nodes, 'right'), '/');
    expect(rhd.nodes.get('pedal')!.pos).toEqual([-600, -400, 800]);
    expect(rhd.nodes.get('pedal')!.rot).toEqual([-0, 0, -30]);
    expect(rhd.nodes.get('pad')!.pos).toEqual([0, -50, 0]);
    expect(rhd.nodes.get('centre')!.pos).toEqual([0, 120, 0]);
  });
});
