/**
 * Verification model.
 *
 * Every component carries three independent confidence facets, because
 * "the part looks right", "the part is in the right place" and "the facts
 * about the part are right" are verified by different evidence:
 *
 *  geometry   placeholder → schematic → representative → accurate
 *  placement  estimated → referenced → calculated → measured
 *  facts      unsourced → secondary → oem
 *
 * A component only counts as *verified* when every facet has reached its
 * minimum level AND a named reviewer has approved each facet. Nothing is
 * ever verified by default — the data build fills in the lowest levels
 * unless a file says otherwise.
 */
export const GEOMETRY_LEVELS = ['placeholder', 'schematic', 'representative', 'accurate'] as const;
export const PLACEMENT_LEVELS = ['estimated', 'referenced', 'calculated', 'measured'] as const;
export const FACT_LEVELS = ['unsourced', 'secondary', 'oem'] as const;
export const REVIEW_SCOPES = ['geometry', 'placement', 'facts'] as const;

export type GeometryLevel = (typeof GEOMETRY_LEVELS)[number];
export type PlacementLevel = (typeof PLACEMENT_LEVELS)[number];
export type FactLevel = (typeof FACT_LEVELS)[number];
export type ReviewScope = (typeof REVIEW_SCOPES)[number];
export type VerificationStatus = 'verified' | 'partial' | 'unverified';

export interface SourceRef {
  ref: string;
  locator?: string;
  says?: string;
}

export interface Review {
  by: string;
  role?: string;
  date: string;
  scope: ReviewScope[];
  verdict: 'approved' | 'changes-requested';
  notes?: string;
}

export interface VerificationFacets {
  geometry: GeometryLevel;
  placement: PlacementLevel;
  facts: FactLevel;
  sources: SourceRef[];
  reviews: Review[];
  notes?: string;
}

/** Minimum facet levels required before a reviewer approval can make a part "verified". */
export const VERIFIED_MINIMUM = {
  geometry: 'representative',
  placement: 'referenced',
  facts: 'oem',
} as const satisfies { geometry: GeometryLevel; placement: PlacementLevel; facts: FactLevel };

export const LEVEL_LABELS: Record<string, string> = {
  placeholder: 'Placeholder',
  schematic: 'Schematic',
  representative: 'Representative',
  accurate: 'Accurate',
  estimated: 'Estimated',
  referenced: 'Referenced',
  calculated: 'Calculated',
  measured: 'Measured',
  unsourced: 'Unsourced',
  secondary: 'Secondary source',
  oem: 'OEM source',
};

export const LEVEL_HELP: Record<string, string> = {
  placeholder: 'Bounding volume only — shows where something is, not what it looks like.',
  schematic: 'Simplified procedural shape with approximately correct proportions.',
  representative: 'Recognisably shaped, key features modelled, dimensions checked against a reference.',
  accurate: 'Derived from measurement, scan or CAD; key dimensions within ±2 mm.',
  estimated: 'Position inferred from general layout knowledge or photos.',
  referenced: 'Position matches workshop-manual location descriptions or diagrams.',
  calculated: 'Coordinates computed from official numbers: wire lengths printed in the wiring diagrams, or the body dimension chart.',
  measured: 'Position measured on a real vehicle (±10 mm).',
  unsourced: 'No cited source yet.',
  secondary: 'Backed by a secondary source (parts supplier, owners forum, press data).',
  oem: 'Backed by OEM documentation (workshop manual, parts catalogue, spec sheet).',
};

function rank<T extends string>(levels: readonly T[], value: T): number {
  return levels.indexOf(value);
}

export function isApproved(v: Pick<VerificationFacets, 'reviews'>, scope: ReviewScope): boolean {
  // The latest review for a scope wins, so a later "changes-requested" revokes an earlier approval.
  const relevant = v.reviews.filter((r) => r.scope.includes(scope)).sort((a, b) => a.date.localeCompare(b.date));
  return relevant.length > 0 && relevant[relevant.length - 1].verdict === 'approved';
}

export function verificationStatus(v: VerificationFacets): VerificationStatus {
  const g = rank(GEOMETRY_LEVELS, v.geometry);
  const p = rank(PLACEMENT_LEVELS, v.placement);
  const f = rank(FACT_LEVELS, v.facts);
  const meetsMinimum =
    g >= rank(GEOMETRY_LEVELS, VERIFIED_MINIMUM.geometry) &&
    p >= rank(PLACEMENT_LEVELS, VERIFIED_MINIMUM.placement) &&
    f >= rank(FACT_LEVELS, VERIFIED_MINIMUM.facts);
  if (meetsMinimum && REVIEW_SCOPES.every((s) => isApproved(v, s))) return 'verified';
  if (g >= 2 || p >= 1 || f >= 1 || v.reviews.length > 0) return 'partial';
  return 'unverified';
}

const GEOMETRY_WEIGHT = [0, 0.25, 0.65, 1];
const PLACEMENT_WEIGHT = [0.1, 0.6, 0.8, 1];
const FACT_WEIGHT = [0, 0.5, 1];

/** 0–100 confidence score used for progress bars and sorting; status remains the authoritative signal. */
export function verificationScore(v: VerificationFacets): number {
  const base =
    0.4 * GEOMETRY_WEIGHT[rank(GEOMETRY_LEVELS, v.geometry)] +
    0.3 * PLACEMENT_WEIGHT[rank(PLACEMENT_LEVELS, v.placement)] +
    0.3 * FACT_WEIGHT[rank(FACT_LEVELS, v.facts)];
  return Math.round(base * 100);
}
