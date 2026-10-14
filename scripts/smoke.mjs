#!/usr/bin/env node
// Installs the tarballs from .pack/tarballs into an empty project (no workspace, no repo node_modules)
// and checks they are usable: types resolve, ESM imports work, assets copy, analysis runs.
//   node scripts/smoke.mjs [--react 18]      (--react 18 installs React 18 + react-konva 18 instead of 19)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tarDir = path.join(root, '.pack', 'tarballs');
const react18 = process.argv.includes('--react') && process.argv[process.argv.indexOf('--react') + 1] === '18';
const dir = path.join(root, '.pack', react18 ? 'smoke-react18' : 'smoke');

if (!existsSync(tarDir)) throw new Error('run scripts/pack.mjs first');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: dir, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ smoke: ${cmd} ${args.join(' ')} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
};

const tars = Object.fromEntries(readdirSync(tarDir).map((f) => [`@codeblocks/${f.replace(/^codeblocks-/, '').replace(/-\d.*$/, '')}`, path.join(tarDir, f)]));
const file = (n) => `file:${tars[n]}`;

const reactDeps = react18
  ? { react: '18.3.1', 'react-dom': '18.3.1', konva: '9.3.22', 'react-konva': '18.2.10', '@types/react': '^18.3.0', '@types/react-dom': '^18.3.0' }
  : { react: '19.2.0', 'react-dom': '19.2.0', konva: '10.7.1', 'react-konva': '19.2.1', '@types/react': '^19.2.0', '@types/react-dom': '^19.2.0' };

writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
  name: 'codeblocks-smoke',
  private: true,
  type: 'module',
  dependencies: { ...Object.fromEntries(Object.keys(tars).map((n) => [n, file(n)])), ...reactDeps, zustand: '^5.0.0' },
  // The tarballs pin exact sibling versions that exist nowhere but here.
  overrides: Object.fromEntries(Object.keys(tars).map((n) => [n, file(n)])),
  devDependencies: { typescript: '5.9.3', '@types/node': '^22.0.0' },
}, null, 2));

writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, jsx: 'react-jsx', skipLibCheck: false, lib: ['ES2023', 'DOM'], types: ['node'] },
  include: ['app.tsx'],
}, null, 2));

writeFileSync(path.join(dir, 'app.tsx'), `
import { analyzeProject, SCENE_VERSION } from '@codeblocks/core';
import type { Scene } from '@codeblocks/core';
import { createCodeBlocks, findNodeAt } from '@codeblocks/runtime';
import type { CodeBlocks } from '@codeblocks/runtime';
import { attachMonaco } from '@codeblocks/runtime/monaco';
import { createBlocksStore } from '@codeblocks/runtime/zustand';
import { createNodeAnalyzer } from '@codeblocks/runtime/node';
import { BlocksPanel, useCodeBlocks } from '@codeblocks/react';
import '@codeblocks/react/styles.css';
import { BlocksCanvas } from '@codeblocks/konva';
import { createAgentTools } from '@codeblocks/agent';

export function Host() {
  const blocks: CodeBlocks | null = useCodeBlocks({ assetBase: '/codeblocks/' });
  if (!blocks) return null;
  const tools = createAgentTools(blocks);
  return <BlocksPanel blocks={blocks} onError={(e) => console.error(e, tools.tools.length)} />;
}
export const unused = [analyzeProject, SCENE_VERSION, createCodeBlocks, findNodeAt, attachMonaco, createBlocksStore, createNodeAnalyzer, BlocksCanvas] as unknown as Scene[];
`);

writeFileSync(path.join(dir, 'run.mjs'), `
import { createCodeBlocks } from '@codeblocks/runtime';
import { createNodeAnalyzer } from '@codeblocks/runtime/node';
import { createAgentTools } from '@codeblocks/agent';
import { SCENE_VERSION } from '@codeblocks/core';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const blocks = createCodeBlocks({ analyzer: createNodeAnalyzer(), controller: { debounceMs: 0 } });
blocks.setFiles([{ name: 'a.ino', content: 'void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);delay(500);}' }], 'a.ino');
await blocks.flush();
const s = blocks.getState();
if (s.status !== 'ready' || !s.scene || s.scene.version !== SCENE_VERSION) throw new Error('analysis failed: ' + JSON.stringify(s.error));
const tools = createAgentTools(blocks);
const overview = await tools.call('blocks_overview', {});
if (!overview.ok) throw new Error('agent tool failed: ' + JSON.stringify(overview));
let ssr = 'SSR panel skipped (konva 9 needs the "canvas" package in Node; load the panel client-only)';
if (!${react18}) {
  const { BlocksPanel } = await import('@codeblocks/react');
  const html = renderToString(createElement(BlocksPanel, { blocks }));
  if (!html.includes('cb-panel')) throw new Error('panel did not render on the server');
  ssr = 'SSR panel ' + html.length + ' bytes';
}
blocks.dispose();
console.log('smoke ok: ' + s.scene.nodes.length + ' blocks, ' + tools.tools.length + ' agent tools, ' + ssr);
`);

// Headless consumers on strict Node ESM resolution (no bundler) must also get working types.
writeFileSync(path.join(dir, 'tsconfig.nodenext.json'), JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, lib: ['ES2023', 'DOM'], types: ['node'] },
  include: ['headless.ts'],
}, null, 2));
writeFileSync(path.join(dir, 'headless.ts'), `
import { analyzeProject } from '@codeblocks/core';
import type { Scene } from '@codeblocks/core';
import { createCodeBlocks } from '@codeblocks/runtime';
import { createNodeAnalyzer } from '@codeblocks/runtime/node';
import { createAgentTools } from '@codeblocks/agent';

const blocks = createCodeBlocks({ analyzer: createNodeAnalyzer() });
const scene: Scene | null = blocks.getState().scene;
export const x = [analyzeProject, createAgentTools(blocks).tools, scene];
`);

run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);
run(process.execPath, [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json']);
run(process.execPath, [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.nodenext.json']);
run(process.execPath, ['run.mjs']);
run(process.execPath, [path.join(dir, 'node_modules', '@codeblocks', 'runtime', 'scripts', 'copy-assets.mjs'), 'public/codeblocks']);
for (const f of ['analyzer.worker.js', 'tree-sitter.wasm', 'tree-sitter-cpp.wasm', 'version.txt']) {
  if (!existsSync(path.join(dir, 'public', 'codeblocks', f))) throw new Error('missing asset ' + f);
}
console.log(`\n✓ smoke passed (${react18 ? 'React 18' : 'React 19'}): ` + readFileSync(path.join(dir, 'public/codeblocks/version.txt'), 'utf8'));
