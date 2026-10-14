// Bundles the analyzer worker into dist/analyzer.worker.js (classic worker, no imports at runtime).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'analyzer.worker.js');
mkdirSync(path.dirname(out), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/worker/entry.ts')],
  outfile: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  // web-tree-sitter feature-detects Node; these branches never run inside a browser worker.
  external: ['fs', 'path', 'fs/promises', 'module', 'url'],
  legalComments: 'none',
  logLevel: 'warning',
});

const hash = createHash('sha256').update(readFileSync(out)).digest('hex').slice(0, 10);
writeFileSync(path.join(root, 'dist', 'version.txt'), hash);
console.log(`built ${path.relative(process.cwd(), out)} (${Math.round(readFileSync(out).length / 1024)} KB, v=${hash})`);
