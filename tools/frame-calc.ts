/**
 * Authoring helper: converts points from a node's local frame to the vehicle frame
 * (or back), using the same transforms as the data build.
 *   npx tsx tools/frame-calc.ts <vehicle-dir> <node-id> x,y,z [x,y,z ...] [--inverse]
 */
import * as THREE from 'three';
import { assemble } from './lib/assemble';
import { loadVehicle } from './lib/load';

const [dir, id, ...rest] = process.argv.slice(2);
const inverse = rest.includes('--inverse');
const v = loadVehicle(dir);
const built = assemble(v);
const b = built.get(id);
if (!b) throw new Error(`unknown node ${id}`);
const m = inverse ? b.world.clone().invert() : b.world;
for (const arg of rest.filter((a) => !a.startsWith('--'))) {
  const [x, y, z] = arg.split(',').map(Number);
  const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
  console.log(`${arg} → [${p.toArray().map((n) => Math.round(n * 10) / 10).join(', ')}]`);
}
