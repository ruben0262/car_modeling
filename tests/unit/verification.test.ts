import { describe, expect, it } from 'vitest';
import { verificationScore, verificationStatus, type VerificationFacets } from '../../src/shared/verification';

const base: VerificationFacets = { geometry: 'placeholder', placement: 'estimated', facts: 'unsourced', sources: [], reviews: [] };
const approveAll = (date = '2026-10-01') => ({ by: 'A. Mechanic', date, scope: ['geometry', 'placement', 'facts'] as const, verdict: 'approved' as const });

describe('verification status', () => {
  it('defaults to unverified', () => {
    expect(verificationStatus(base)).toBe('unverified');
    expect(verificationScore(base)).toBeLessThan(10);
  });

  it('any evidence makes a component partially verified', () => {
    expect(verificationStatus({ ...base, facts: 'secondary', sources: [{ ref: 'x' }] })).toBe('partial');
    expect(verificationStatus({ ...base, placement: 'referenced' })).toBe('partial');
  });

  it('high facet levels alone are not enough without a reviewer', () => {
    const v: VerificationFacets = { ...base, geometry: 'accurate', placement: 'measured', facts: 'oem' };
    expect(verificationStatus(v)).toBe('partial');
  });

  it('is verified only with minimum levels and approval of every facet', () => {
    const v: VerificationFacets = { ...base, geometry: 'representative', placement: 'referenced', facts: 'oem', reviews: [{ ...approveAll(), scope: [...approveAll().scope] }] };
    expect(verificationStatus(v)).toBe('verified');
    const missingFacet = { ...v, reviews: [{ ...approveAll(), scope: ['geometry', 'placement'] as ('geometry' | 'placement')[] }] };
    expect(verificationStatus(missingFacet)).toBe('partial');
  });

  it('a later "changes requested" review revokes an earlier approval', () => {
    const v: VerificationFacets = {
      ...base,
      geometry: 'accurate',
      placement: 'measured',
      facts: 'oem',
      reviews: [
        { ...approveAll('2026-09-01'), scope: ['geometry', 'placement', 'facts'] },
        { by: 'B. Reviewer', date: '2026-10-02', scope: ['placement'], verdict: 'changes-requested' },
      ],
    };
    expect(verificationStatus(v)).toBe('partial');
  });
});
