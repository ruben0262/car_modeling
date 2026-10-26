import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { BodySurface, monotone } from '../../tools/geometry/body';

describe('monotone interpolation', () => {
  it('never overshoots the data between stations', () => {
    const f = monotone([0, 1, 2, 3], [0, 0, 10, 10]);
    for (let x = 0; x <= 3; x += 0.05) {
      expect(f(x)).toBeGreaterThanOrEqual(-1e-9);
      expect(f(x)).toBeLessThanOrEqual(10 + 1e-9);
    }
  });
});

describe('Freelander 2 body surface', () => {
  const v = parse(readFileSync('data/vehicles/land-rover/freelander-2/l359-2010-td4/vehicle.yaml', 'utf8'));
  const S = new BodySurface(v.shapes.body);

  it('is left/right symmetric', () => {
    for (const x of [500, -1000, -3000])
      for (const t of [0.3, 1.2, 2.5]) {
        const l = S.point(x, t);
        const r = S.point(x, 6 - t);
        expect(r[1]).toBeCloseTo(-l[1], 6);
        expect(r[2]).toBeCloseTo(l[2], 6);
      }
  });

  it('peaks at the centreline and stays within the published envelope', () => {
    for (let x = -3600; x <= 860; x += 100) {
      const top = S.point(x, 3)[2];
      expect(top).toBeLessThanOrEqual(1740);
      for (let t = 0; t <= 3; t += 0.25) expect(Math.abs(S.point(x, t)[1])).toBeLessThanOrEqual(955);
    }
  });
});
