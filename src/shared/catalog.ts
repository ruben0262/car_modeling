/** Vehicle catalogue search: free text over make/model/variant/engine plus year matching against the generation's years. */
import type { CatalogEntry } from './manifest';
import { buildIndex, search, tokenize } from './search';

export function searchCatalog(vehicles: CatalogEntry[], q: string): CatalogEntry[] {
  const years = tokenize(q)
    .map(Number)
    .filter((n) => n >= 1950 && n <= 2100);
  const text = q.replace(/\b(19|20)\d{2}\b/g, ' ').trim();
  let list = vehicles.filter((v) => years.every((y) => y >= v.years[0] && y <= v.years[1]));
  if (text) {
    const index = buildIndex(
      list.map((v) => ({
        item: v,
        fields: [
          { text: `${v.make} ${v.model}`, weight: 3 },
          { text: v.aliases.join(' '), weight: 2 },
          { text: `${v.variant} ${v.engine} ${v.transmission} ${v.drive}`, weight: 1.5 },
          { text: `${v.generation} ${v.market}`, weight: 1 },
        ],
      })),
    );
    list = search(index, text, 50).map((r) => r.item);
  }
  return list;
}
