#!/usr/bin/env node
// Builds installable tarballs for every publishable package into .pack/tarballs/.
//   node scripts/pack.mjs            build + pack
//   node scripts/pack.mjs --smoke    also install them into a clean temp project and typecheck/import
//
// Dev workspaces keep resolving "./src/*.ts" (no build step while developing). Only the staged copy that is
// packed gets a rewritten manifest: compiled ESM + .d.ts under dist/, exact sibling versions, no devDependencies.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = path.join(root, '.pack');
const stageRoot = path.join(pack, 'stage');
const tarballs = path.join(pack, 'tarballs');

// Dependency order: a package may only import packages listed before it.
const ORDER = ['core', 'runtime', 'konva', 'react', 'agent'];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} ${args.join(' ')} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
};
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

// tsc rewrites relative ".ts" specifiers in the emitted .js but leaves them in .d.ts; consumers using
// node16/nodenext resolution cannot resolve those, so point them at ".js" like the runtime files.
function fixDeclarationSpecifiers(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { fixDeclarationSpecifiers(f); continue; }
    if (!e.name.endsWith('.d.ts')) continue;
    const text = readFileSync(f, 'utf8');
    const fixed = text.replace(/(\bfrom\s+|\bimport\(\s*)(['"])(\.{1,2}\/[^'"]+)\.ts\2/g, '$1$2$3.js$2');
    if (fixed !== text) writeFileSync(f, fixed);
  }
}

rmSync(pack, { recursive: true, force: true });
mkdirSync(tarballs, { recursive: true });

const manifests = Object.fromEntries(ORDER.map((n) => [n, readJson(path.join(root, 'packages', n, 'package.json'))]));
const version = manifests.core.version;
for (const [n, m] of Object.entries(manifests)) {
  if (m.version !== version) throw new Error(`packages must share one version; ${m.name} is ${m.version}, core is ${version}`);
}

const distOf = (srcPath) => srcPath.replace(/^\.\/src\//, './dist/');
const toDist = (target) => {
  if (!target.endsWith('.ts')) return distOf(target); // e.g. styles.css
  const js = distOf(target).replace(/\.ts$/, '.js');
  return { types: js.replace(/\.js$/, '.d.ts'), default: js };
};

// Maps "@codeblocks/x[/sub]" to the already-built .d.ts so later packages type-check against what ships.
const paths = {};
const addPaths = (name, manifest) => {
  for (const [sub, target] of Object.entries(manifest.exports)) {
    if (typeof target !== 'string' || !target.endsWith('.ts')) continue;
    const key = sub === '.' ? name : `${name}/${sub.slice(2)}`;
    paths[key] = [path.join(stageRoot, name.split('/')[1], toDist(target).types)];
  }
};

for (const n of ORDER) {
  const m = manifests[n];
  const src = path.join(root, 'packages', n);
  const stage = path.join(stageRoot, n);
  mkdirSync(stage, { recursive: true });

  const tsconfig = path.join(pack, `tsconfig.${n}.json`);
  writeFileSync(tsconfig, JSON.stringify({
    extends: path.join(root, 'tsconfig.base.json'),
    compilerOptions: {
      noEmit: false,
      outDir: path.join(stage, 'dist'),
      rootDir: path.join(src, 'src'),
      declaration: true,
      rewriteRelativeImportExtensions: true,
      allowImportingTsExtensions: false,
      sourceMap: false,
      types: ['node'],
      typeRoots: [path.join(root, 'node_modules', '@types')],
      paths,
    },
    include: [path.join(src, 'src')],
    // The worker entry ships as the esbuild bundle (dist/analyzer.worker.js), not as module files.
    exclude: [path.join(src, 'src', 'worker')],
  }, null, 2));
  console.log(`\n▸ ${m.name}`);
  run(process.execPath, [tsc, '-p', tsconfig]);
  addPaths(m.name, m);
  fixDeclarationSpecifiers(path.join(stage, 'dist'));

  // Non-TS assets that live next to the sources.
  for (const f of readdirSync(path.join(src, 'src'))) if (f.endsWith('.css')) cpSync(path.join(src, 'src', f), path.join(stage, 'dist', f));

  const files = ['dist'];
  if (n === 'runtime') {
    run(process.execPath, [path.join(src, 'scripts', 'build-worker.mjs')]);
    mkdirSync(path.join(stage, 'dist'), { recursive: true });
    cpSync(path.join(src, 'dist', 'analyzer.worker.js'), path.join(stage, 'dist', 'analyzer.worker.js'));
    cpSync(path.join(src, 'dist', 'version.txt'), path.join(stage, 'dist', 'version.txt'));
    mkdirSync(path.join(stage, 'scripts'), { recursive: true });
    cpSync(path.join(src, 'scripts', 'copy-assets.mjs'), path.join(stage, 'scripts', 'copy-assets.mjs'));
    files.push('scripts/copy-assets.mjs');
  }

  const out = { ...m };
  delete out.private;
  delete out.devDependencies;
  delete out.scripts;
  out.exports = Object.fromEntries(Object.entries(m.exports).map(([k, v]) => [k, toDist(v)]));
  out.files = files;
  if (m.dependencies) {
    out.dependencies = Object.fromEntries(Object.entries(m.dependencies).map(([k, v]) => [k, k.startsWith('@codeblocks/') ? version : v]));
  }
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(out, null, 2) + '\n');
  const readme = path.join(src, 'README.md');
  if (existsSync(readme)) cpSync(readme, path.join(stage, 'README.md'));

  run('npm', ['pack', '--pack-destination', tarballs, '--silent'], { cwd: stage });
}

console.log('\n✓ tarballs:');
for (const f of readdirSync(tarballs)) console.log('  ' + path.join('.pack/tarballs', f));

if (process.argv.includes('--smoke')) run(process.execPath, [path.join(root, 'scripts', 'smoke.mjs')]);
