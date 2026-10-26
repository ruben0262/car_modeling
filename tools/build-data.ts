/**
 * Data build: data/vehicles/** (YAML) → public/data (GLB chunks + manifests + catalogue).
 *
 *   npm run data            build, report problems, keep going on warnings
 *   npm run data:strict     also fail on automated-check errors (used by CI / `npm run build`)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { MANIFEST_SCHEMA_VERSION, type Catalog, type CatalogEntry } from '../src/shared/manifest';
import { assemble } from './lib/assemble';
import { runChecks } from './lib/checks';
import { emitVehicle } from './lib/emit';
import { synthesizeHarness } from './lib/harness';
import { deriveLinks } from './lib/links';
import { DataError, loadVehicle } from './lib/load';
import { emitMedia } from './lib/media';
import { DescriptionsFile } from './lib/schema';
import { parse } from 'yaml';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const verbose = process.argv.includes('--verbose');
const dataDir = join(root, 'data', 'vehicles');
const outRoot = join(root, 'public', 'data');

function findVehicleDirs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findVehicleDirs(p));
    else if (entry === 'vehicle.yaml') out.push(dirname(p));
  }
  return out;
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  const t0 = performance.now();
  mkdirSync(outRoot, { recursive: true });
  const dirs = existsSync(dataDir) ? findVehicleDirs(dataDir) : [];
  const catalog: CatalogEntry[] = [];
  let failed = false;
  // shared library of general part descriptions
  const libPath = join(root, 'data', 'library', 'descriptions.yaml');
  const lib = existsSync(libPath) ? DescriptionsFile.safeParse(parse(readFileSync(libPath, 'utf8'))) : null;
  if (lib && !lib.success) {
    console.error(`✖ ${relative(root, libPath)}\n  ${lib.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`);
    process.exit(1);
  }

  for (const dir of dirs) {
    const label = relative(root, dir);
    try {
      const v = loadVehicle(dir, root);
      const built = assemble(v);
      const w = v.vehicle.wiring;
      const json = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const ewd = w ? json(w.file) : undefined;
      // connect every electrical part to the harness network before checking (generated branches are checked too);
      // other model years are laid out on the same network, and printed wire lengths place what they can
      const harness =
        w && ewd
          ? synthesizeHarness(v, built, ewd, {
              lengths: w.lengths ? json(w.lengths.file) : undefined,
              others: w.publications.map((p) => ({ id: p.id, data: json(p.file) })),
            })
          : undefined;
      const derived = deriveLinks(v, built);
      const checks = runChecks(v, built, ewd);
      if (harness) checks.splice(checks.findIndex((c) => c.id === 'coverage'), 0, harness.check, harness.lengthCheck);
      const { manifest } = await emitVehicle(v, built, checks, outRoot, harness ? { main: harness.layout, others: harness.layouts } : undefined, lib?.data);
      const s = manifest.stats;
      console.log(`\n▸ ${manifest.vehicle.make} ${manifest.vehicle.model} ${manifest.vehicle.modelYear} ${manifest.vehicle.variant.name}  (${label})`);
      console.log(`  ${s.nodes} nodes · ${s.parts} parts · ${s.connectors} connectors · ${s.lines} lines`);
      const links = manifest.nodes.reduce((a, n) => a + (n.links?.filter((l) => l.evidence === 'authored').length ?? 0), 0) / 2;
      console.log(`  ${links} documented joints · ${derived} hose, pipe and cable ends linked from the model`);
      const parts = manifest.nodes.filter((n) => n.kind !== 'system');
      const general = parts.filter((n) => n.summaryGeneral).length;
      const none = parts.filter((n) => !n.summary).map((n) => n.name);
      console.log(`  descriptions: ${parts.length - general - none.length} specific · ${general} general · ${none.length} none${none.length && verbose ? ` (${[...new Set(none)].slice(0, 40).join('; ')})` : ''}`);
      console.log(`  ${s.triangles.toLocaleString()} triangles · ${kb(s.bytes)} initial geometry in ${manifest.chunks.filter((c) => c.role === 'system').length} chunks`);
      const detail = manifest.chunks.filter((c) => c.role === 'detail');
      if (detail.length) console.log(`  ${detail.length} on-demand detail chunks (${kb(detail.reduce((a, c) => a + c.bytes, 0))})`);
      for (const c of checks) {
        const icon = c.severity === 'error' ? '✖' : c.severity === 'warning' ? '▲' : '·';
        console.log(`  ${icon} ${c.title}`);
        if (c.detail && (c.severity !== 'info' || verbose)) for (const line of c.detail.split('\n').slice(0, verbose ? 400 : 25)) console.log(`      ${line}`);
      }
      if (strict && checks.some((c) => c.severity === 'error')) failed = true;
      const media = emitMedia(dir, manifest, join(outRoot, 'vehicles', manifest.vehicle.id));
      if (media) console.log(`  ${media.current ? '·' : '▲'} catalogue images rendered ${media.rendered}${media.current ? '' : ' from an older model: re-run tools/render-images.mjs'}`);
      const defaultIssue = manifest.wiring?.publications.find((p) => p.isDefault);
      catalog.push({
        id: manifest.vehicle.id,
        make: manifest.vehicle.make,
        model: manifest.vehicle.model,
        generation: manifest.vehicle.generation.code,
        years: manifest.vehicle.generation.years,
        modelYear: manifest.vehicle.modelYear,
        variant: manifest.vehicle.variant.name,
        engine: manifest.vehicle.variant.engine,
        transmission: manifest.vehicle.variant.transmission,
        drive: manifest.vehicle.variant.drive,
        market: manifest.vehicle.variant.market,
        aliases: manifest.vehicle.aliases,
        manifest: `data/vehicles/${manifest.vehicle.id}/manifest.json`,
        stats: { parts: s.nodes - manifest.systems.length, ...s.byStatus, bytes: s.bytes },
        systems: manifest.systems.map((x) => ({ id: x.id, name: x.name, short: x.short, color: x.color })),
        highlights: {
          joints: links,
          connectors: s.connectors,
          wires: defaultIssue?.stats.wires ?? 0,
          wiringIssues: manifest.wiring?.publications.length ?? 0,
          sources: Object.keys(manifest.sources).length,
        },
        media,
      });
    } catch (e) {
      failed = true;
      if (e instanceof DataError) console.error(`\n✖ ${label}\n  ${e.message.replace(/\n/g, '\n  ')}`);
      else throw e;
    }
  }

  const out: Catalog = { schema: MANIFEST_SCHEMA_VERSION, vehicles: catalog };
  writeFileSync(join(outRoot, 'catalog.json'), JSON.stringify(out));
  console.log(`\n${catalog.length} vehicle(s) built in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${relative(root, outRoot)}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
