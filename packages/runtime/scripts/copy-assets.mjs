#!/usr/bin/env node
// Copies everything the browser needs into a public folder:
//   analyzer.worker.js, tree-sitter.wasm, tree-sitter-cpp.wasm, version.txt
// usage: codeblocks-assets <outDir>      (e.g. `codeblocks-assets public/codeblocks`)
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const outDir = path.resolve(process.argv[2] ?? 'public/codeblocks');

const workerFile = path.join(root, 'dist', 'analyzer.worker.js');
if (!existsSync(workerFile)) {
  const r = spawnSync(process.execPath, [path.join(here, 'build-worker.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const files = [
  [workerFile, 'analyzer.worker.js'],
  [path.join(root, 'dist', 'version.txt'), 'version.txt'],
  [path.join(pkgDir('web-tree-sitter'), 'tree-sitter.wasm'), 'tree-sitter.wasm'],
  [path.join(pkgDir('tree-sitter-wasms'), 'out', 'tree-sitter-cpp.wasm'), 'tree-sitter-cpp.wasm'],
];

mkdirSync(outDir, { recursive: true });
for (const [src, name] of files) copyFileSync(src, path.join(outDir, name));
console.log(`codeblocks assets → ${path.relative(process.cwd(), outDir) || '.'} (v=${readFileSync(path.join(outDir, 'version.txt'), 'utf8')})`);
