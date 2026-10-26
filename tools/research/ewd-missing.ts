/**
 * Lists the wiring-diagram components that apply to a vehicle but have no 3D part yet, with their
 * connectors, harness family (first digit of the connector id) and first circuit sheets.
 *
 *   npx tsx tools/research/ewd-missing.ts data/vehicles/<make>/<model>/<variant>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EwdData } from '../../src/shared/wiring';
import { relevantEwdComponents } from '../lib/emit';
import { loadVehicle } from '../lib/load';

const dir = process.argv[2];
const v = loadVehicle(dir);
const w = v.vehicle.wiring;
if (!w) throw new Error('vehicle has no wiring block');
const ewd = JSON.parse(readFileSync(join(dir, w.file), 'utf8')) as EwdData;
const mapped = new Set([...v.nodes.values()].flatMap((n) => n.ewd));
const relevant = relevantEwdComponents(ewd, new Set(w.notApplicable.flatMap((n) => n.codes)));
const missing = [...relevant].filter((c) => !mapped.has(c)).sort();
for (const code of missing) {
  const c = ewd.components[code];
  const families = [...new Set(c.connectors.map((x) => x[1]))].join('');
  console.log(`${code}\t${c.name}\t[${c.connectors.join(' ')}]\tfamily ${families || '-'}\t${c.circuits.slice(0, 3).join(' | ')}`);
}
console.log(`${missing.length} missing of ${relevant.size} relevant components`);
