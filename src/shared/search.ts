/**
 * Small, dependency-free ranked search used for both part search inside a
 * vehicle and vehicle search on the landing page. Mechanics rarely use the
 * workshop-manual term ("BJB") first, so domain synonyms expand the query.
 */

const SYNONYMS: Record<string, string[]> = {
  ecu: ['ecm', 'module', 'control'],
  ecm: ['ecu', 'engine control module'],
  fusebox: ['junction', 'bjb', 'cjb'],
  fuse: ['junction', 'bjb', 'cjb', 'fusebox'],
  diff: ['differential', 'rdu'],
  differential: ['diff', 'rdu'],
  gearbox: ['transmission'],
  transmission: ['gearbox'],
  cat: ['catalytic', 'converter'],
  dpf: ['particulate'],
  muffler: ['silencer'],
  silencer: ['muffler'],
  shock: ['damper', 'strut'],
  damper: ['shock', 'strut'],
  intercooler: ['charge', 'cac'],
  cac: ['intercooler', 'charge'],
  haldex: ['coupling', 'awd', 'aod'],
  awd: ['haldex', 'coupling', 'ptu'],
  '4wd': ['haldex', 'ptu', 'awd'],
  wire: ['harness', 'cable'],
  wiring: ['harness', 'cable'],
  loom: ['harness'],
  plug: ['connector'],
  tyre: ['tire', 'wheel'],
  tire: ['tyre', 'wheel'],
  alternator: ['generator'],
  generator: ['alternator'],
  hood: ['bonnet'],
  bonnet: ['hood'],
  trunk: ['luggage', 'boot', 'tailgate'],
  boot: ['luggage', 'tailgate'],
  fender: ['wing'],
  wing: ['fender'],
  rad: ['radiator'],
  abs: ['anti-lock', 'modulator'],
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

export interface SearchField {
  text: string;
  weight: number;
}

export interface SearchDoc<T> {
  item: T;
  fields: SearchField[];
}

interface IndexedDoc<T> {
  item: T;
  tokens: { token: string; weight: number }[];
  phrases: { text: string; weight: number }[];
}

export interface SearchIndex<T> {
  docs: IndexedDoc<T>[];
}

export function buildIndex<T>(docs: SearchDoc<T>[]): SearchIndex<T> {
  return {
    docs: docs.map((d) => ({
      item: d.item,
      tokens: d.fields.flatMap((f) => tokenize(f.text).map((token) => ({ token, weight: f.weight }))),
      phrases: d.fields.map((f) => ({ text: f.text.toLowerCase(), weight: f.weight })),
    })),
  };
}

/** Levenshtein distance capped at `max` (returns max+1 when exceeded). */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function termScore(term: string, token: string): number {
  if (token === term) return 1;
  if (token.startsWith(term)) return term.length >= 2 ? 0.8 : 0.35;
  if (term.length >= 4 && token.includes(term)) return 0.5;
  if (term.length >= 4 && token.length >= 4 && boundedEditDistance(term, token, 1) <= 1) return 0.45;
  return 0;
}

export function search<T>(index: SearchIndex<T>, query: string, limit = 25): { item: T; score: number }[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const lowered = query.trim().toLowerCase();
  const results: { item: T; score: number }[] = [];

  for (const doc of index.docs) {
    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      const variants = [term, ...(SYNONYMS[term] ?? [])];
      let best = 0;
      for (const tok of doc.tokens) {
        for (let v = 0; v < variants.length; v++) {
          const s = termScore(variants[v], tok.token) * tok.weight * (v === 0 ? 1 : 0.7);
          if (s > best) best = s;
        }
      }
      if (best === 0) {
        matchedAll = false;
        break;
      }
      total += best;
    }
    if (!matchedAll) continue;
    for (const p of doc.phrases) {
      if (p.text === lowered) total += 2 * p.weight;
      else if (p.text.startsWith(lowered)) total += 0.6 * p.weight;
    }
    // tie-break towards the more specific item ("Battery" before "Battery junction box")
    total += 0.5 / (1 + doc.tokens.length);
    results.push({ item: doc.item, score: total });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
