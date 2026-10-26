// Writes .br and .gz copies next to every compressible file of a built site, so the server can send them
// as they are instead of compressing on each request (Caddy `precompressed`, nginx `gzip_static`).
// Geometry is meshopt-encoded but still roughly halves again. Run after `vite build`:
//
//   node tools/precompress.mjs dist
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const COMPRESSIBLE = /\.(html|js|css|json|svg|glb|txt)$/;
let files = 0;
let raw = 0;
let packed = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (COMPRESSIBLE.test(name) && stat.size > 1024) {
      const bytes = readFileSync(path);
      const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
      const gz = gzipSync(bytes, { level: 9 });
      // a copy that saves almost nothing is not worth a second file
      if (br.length < bytes.length * 0.95) writeFileSync(`${path}.br`, br);
      if (gz.length < bytes.length * 0.95) writeFileSync(`${path}.gz`, gz);
      files++;
      raw += bytes.length;
      packed += Math.min(br.length, bytes.length);
    }
  }
}

walk(root);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`precompressed ${files} files: ${mb(raw)} MB → ${mb(packed)} MB with brotli`);
