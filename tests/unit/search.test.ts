import { describe, expect, it } from 'vitest';
import { searchCatalog } from '../../src/shared/catalog';
import type { CatalogEntry } from '../../src/shared/manifest';
import { boundedEditDistance, buildIndex, search } from '../../src/shared/search';

const parts = buildIndex(
  [
    { id: 'bjb', name: 'Battery junction box (BJB)', aliases: ['engine fuse box'] },
    { id: 'cjb', name: 'Central junction box (CJB)', aliases: ['interior fuse box'] },
    { id: 'battery', name: 'Battery (12 V)', aliases: ['accumulator'] },
    { id: 'turbo', name: 'Turbocharger (variable geometry)', aliases: ['turbo'] },
    { id: 'ecm', name: 'Engine control module (ECM)', aliases: [] },
  ].map((p) => ({ item: p.id, fields: [{ text: p.name, weight: 3 }, { text: p.aliases.join(' '), weight: 2 }] })),
);

describe('part search', () => {
  it('finds both fuse boxes for the mechanic term "fuse box"', () => {
    const ids = search(parts, 'fuse box').map((r) => r.item);
    expect(ids.slice(0, 2).sort()).toEqual(['bjb', 'cjb']);
  });

  it('maps "ecu" to the ECM via synonyms', () => {
    expect(search(parts, 'ecu')[0]?.item).toBe('ecm');
  });

  it('tolerates a one-letter typo', () => {
    expect(search(parts, 'turbocharher')[0]?.item).toBe('turbo');
    expect(boundedEditDistance('battery', 'batery', 1)).toBe(1);
  });

  it('prefix matches while typing', () => {
    expect(search(parts, 'batt')[0]?.item).toBe('battery');
  });
});

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  id: 'x', make: 'Land Rover', model: 'Freelander 2', generation: 'L359', years: [2006, 2014], modelYear: 2010, variant: '2.2 TD4',
  engine: '2.2 Duratorq TD4 diesel', transmission: '6-speed automatic', drive: 'AWD', market: 'UK', aliases: ['LR2'],
  manifest: '', stats: { parts: 1, verified: 0, partial: 0, unverified: 1, bytes: 1 }, systems: [],
  highlights: { joints: 0, connectors: 0, wires: 0, wiringIssues: 0, sources: 0 }, ...over,
});

describe('vehicle search', () => {
  const list = [entry({ id: 'fl2' }), entry({ id: 'evoque', model: 'Range Rover Evoque', generation: 'L538', years: [2011, 2018], aliases: [] })];
  it('matches make/model text with a year inside the generation range', () => {
    expect(searchCatalog(list, 'freelander 2010 diesel').map((v) => v.id)).toEqual(['fl2']);
    expect(searchCatalog(list, 'land rover 2012').map((v) => v.id).sort()).toEqual(['evoque', 'fl2']);
  });
  it('excludes vehicles outside the year', () => {
    expect(searchCatalog(list, 'freelander 2020')).toEqual([]);
  });
  it('matches aliases', () => {
    expect(searchCatalog(list, 'LR2').map((v) => v.id)).toEqual(['fl2']);
  });
});
