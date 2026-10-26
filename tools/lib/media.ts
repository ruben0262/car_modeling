/**
 * Catalogue images: renders of the 3D model made by tools/render-images.mjs and kept with the vehicle's
 * data (media/). The build copies them next to the geometry with content-hashed names and checks that
 * the parts they mark still exist and that the model has not changed since they were rendered.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CatalogMedia, Manifest } from '../../src/shared/manifest';
import { DataError } from './load';

const MediaFile = z
  .object({
    rendered: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    modelHash: z.string(),
    images: z.record(
      z.string().regex(/^[a-z0-9-]+$/),
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        files: z.array(z.object({ width: z.number().int().positive(), file: z.string().regex(/^[a-z0-9-]+\.webp$/) })).min(1),
      }),
    ),
    hotspots: z.array(z.object({ id: z.string(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })),
  })
  .strict();

/** The same fingerprint tools/render-images.mjs records: the content hashes of the system chunks. */
export function modelHash(manifest: Manifest): string {
  return manifest.chunks
    .filter((c) => c.role === 'system')
    .map((c) => c.url.split('.').slice(-2, -1)[0])
    .sort()
    .join('');
}

export function emitMedia(vehicleDir: string, manifest: Manifest, outDir: string): CatalogMedia | undefined {
  const dir = join(vehicleDir, 'media');
  const index = join(dir, 'media.json');
  if (!existsSync(index)) return undefined;
  const parsed = MediaFile.safeParse(JSON.parse(readFileSync(index, 'utf8')));
  if (!parsed.success) throw new DataError(parsed.error.issues.map((i) => `media/media.json ${i.path.join('.')}: ${i.message}`));
  const vid = manifest.vehicle.id;
  const nodes = new Map(manifest.nodes.map((n) => [n.id, n]));
  const systems = new Map(manifest.systems.map((s) => [s.id, s]));
  const images: CatalogMedia['images'] = {};
  for (const [name, img] of Object.entries(parsed.data.images)) {
    const files = img.files.map((f) => {
      const path = join(dir, f.file);
      if (!existsSync(path)) throw new DataError([`media/media.json lists ${f.file}, which is missing: re-run tools/render-images.mjs`]);
      const bytes = readFileSync(path);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
      const out = f.file.replace(/\.webp$/, `.${hash}.webp`);
      writeFileSync(join(outDir, out), bytes);
      return { width: f.width, url: `data/vehicles/${vid}/${out}` };
    });
    images[name] = { width: img.width, height: img.height, files: files.sort((a, b) => a.width - b.width) };
  }
  const hotspots = parsed.data.hotspots.map((h) => {
    const n = nodes.get(h.id);
    if (!n) throw new DataError([`media/media.json marks "${h.id}", which is not a component of this vehicle: re-run tools/render-images.mjs`]);
    return { id: h.id, name: n.name, system: n.system, color: systems.get(n.system)?.color ?? '#8f99b2', x: h.x, y: h.y };
  });
  return { rendered: parsed.data.rendered, current: parsed.data.modelHash === modelHash(manifest), images, hotspots };
}
