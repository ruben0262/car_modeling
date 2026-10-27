import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { describeColour, endKind, splitPin, type EwdData } from '../../src/shared/wiring';
import { runChecks } from '../../tools/lib/checks';

describe('wiring helpers', () => {
  it('decodes JLR colour codes with tracers', () => {
    expect(describeColour('BU-OG')).toBe('blue with orange tracer');
    expect(describeColour('BK')).toBe('black');
  });
  it('classifies endpoints and splits pins', () => {
    expect(endKind('C1BP02B-15')).toBe('pin');
    expect(endKind('S1BB33')).toBe('splice');
    expect(endKind('G1D108A-1')).toBe('ground');
    expect(splitPin('C1BP02B-15')).toEqual({ connector: 'C1BP02B', pin: '15' });
  });
});

describe('VW wiring (VW Sharan diagrams used for the Ford Galaxy)', () => {
  const galaxy = JSON.parse(readFileSync('data/vehicles/ford/galaxy/wgr-1998-19tdi/wiring/vw-sharan-1998-jan.json', 'utf8')) as EwdData;

  it('decodes VW colour codes with tracers', () => {
    expect(describeColour('sw/ws')).toBe('black with white tracer');
    expect(describeColour('ro')).toBe('red');
  });
  it('classifies VW endpoints from the netlist', () => {
    const data = { splices: { B163: { wires: [] } }, grounds: { '29': { wires: [] } } } as Pick<EwdData, 'splices' | 'grounds'>;
    expect(endKind('B163', data)).toBe('splice');
    expect(endKind('29', data)).toBe('ground');
    expect(endKind('T25.20-14', data)).toBe('pin');
    expect(splitPin("T2.20'-1")).toEqual({ connector: "T2.20'", pin: '1' });
  });
  it('keeps connector codes apart per diagram and wires each ABS sensor through its own plug', () => {
    // "T2" names a different connector in the ABS diagram (No. 20) than elsewhere
    expect(galaxy.connectors['T2.20'].name).toMatch(/^2-pin connector/);
    expect(galaxy.connectors["T2.20'"].mates).toBe('T2.20');
    const g45 = Object.values(galaxy.connectors['G45'].pins).flatMap((p) => p.wires);
    expect(g45).toEqual(expect.arrayContaining(["W:G45-1~T2.20'-1", "W:G45-2~T2.20'-2"]));
    // the plug of a control unit drawn with its valves inside belongs to the control unit
    expect(galaxy.connectors['T25.20'].component).toBe('J104');
  });
  it('reads two-line legend entries without merging them into the previous one', () => {
    expect(galaxy.components.V.name).toBe('Windscreen wiper motor');
    expect(galaxy.components.X.name).toBe('Number plate light');
    expect(galaxy.splices['131'].name).toMatch(/^Earth connection -2-, in engine compartment wiring harness/);
  });
  it('finds both ends of nearly every wire', () => {
    const both = galaxy.wires.filter((w) => w.ends.length === 2).length;
    expect(both / galaxy.wires.length).toBeGreaterThan(0.95);
  });
});

describe('duplicate detection', () => {
  it('flags one wiring-diagram component mapped to two parts', async () => {
    const { loadVehicle } = await import('../../tools/lib/load');
    const { assemble } = await import('../../tools/lib/assemble');
    const v = loadVehicle('data/vehicles/land-rover/freelander-2/l359-2010-td4');
    // simulate a part left behind after being re-authored: same EWD code on another node
    v.nodes.get('horns')!.ewd = ['P100'];
    const ewd: Pick<EwdData, 'components' | 'connectors' | 'circuits'> = {
      components: { P100: { name: 'Battery', connectors: [], circuits: [] } },
      connectors: {},
      circuits: [],
    };
    const checks = runChecks(v, assemble(v), ewd as EwdData);
    const dup = checks.find((c) => c.id === 'duplicates')!;
    expect(dup.severity).toBe('error');
    expect(dup.detail).toMatch(/P100 is mapped to battery, horns/);
  }, 30_000);
});

