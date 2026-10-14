// Run the engine over a directory of real sketches and fail on crashes, layout violations or slowness.
//   npm run corpus -- /path/to/arduino-examples [--mode kids|code] [--budget-ms 400]
// Each folder containing .ino files is treated as ONE multi-tab sketch (like the Arduino IDE does).

import fs from 'node:fs';
import path from 'node:path';
import { analyzeProject } from '../src/index.ts';
import { validateScene } from '../src/validate.ts';
import { configureNode } from '../test/setup.ts';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) as string;
const opt = (name: string, d: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const mode = opt('mode', 'kids') as 'kids' | 'code';
const budget = Number(opt('budget-ms', '400'));
if (!dir) { console.error('usage: corpus <dir> [--mode kids|code] [--budget-ms N]'); process.exit(2); }

configureNode();

const sketches = new Map<string, string[]>();
(function walk(d: string): void {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.toLowerCase().endsWith('.ino')) (sketches.get(d) ?? sketches.set(d, []).get(d) as string[]).push(p);
  }
})(dir);

let crashes = 0, violations = 0, slow = 0, syntax = 0, nodes = 0, total = 0, unknownCalls = new Map<string, number>();
const worst: [string, number][] = [];
for (const [folder, paths] of sketches) {
  const files = paths.map((p) => ({ name: path.basename(p), content: fs.readFileSync(p, 'utf8') }));
  const main = `${path.basename(folder)}.ino`;
  const t = performance.now();
  try {
    const r = await analyzeProject(files, { mode, main: files.some((f) => f.name === main) ? main : undefined });
    const ms = performance.now() - t;
    total += ms; nodes += r.scene.nodes.length; worst.push([folder, ms]);
    const v = validateScene(r.scene);
    if (v.length) { violations++; console.log(`VIOLATION ${folder}: ${v.slice(0, 3).map((x) => x.message).join(' | ')}`); }
    if (ms > budget) { slow++; console.log(`SLOW ${folder}: ${Math.round(ms)}ms`); }
    if (r.diagnostics.length) { syntax++; console.log(`SYNTAX ${folder}: ${r.diagnostics[0].file}:${r.diagnostics[0].line} ${r.diagnostics[0].message}`); }
    for (const n of r.scene.nodes) if (n.kind === 'library' && n.category === 'CALL') unknownCalls.set(n.text ?? '', (unknownCalls.get(n.text ?? '') ?? 0) + 1);
  } catch (e) {
    crashes++;
    console.log(`CRASH ${folder}: ${(e as Error).message}`);
  }
}
worst.sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({
  sketches: sketches.size, mode, crashes, layoutViolations: violations, overBudget: slow, withSyntaxIssues: syntax,
  totalBlocks: nodes, avgMs: Math.round(total / Math.max(1, sketches.size)), slowest: worst.slice(0, 3).map(([f, ms]) => `${path.basename(f)} ${Math.round(ms)}ms`),
}, null, 1));
process.exit(crashes || violations ? 1 : 0);
