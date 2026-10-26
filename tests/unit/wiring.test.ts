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

