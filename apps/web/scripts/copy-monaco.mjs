// Serve Monaco from our own origin (no CDN): required for locked-down school networks.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve('monaco-editor/package.json')), 'min', 'vs');
const dest = path.resolve('public/monaco/vs');
if (existsSync(path.join(dest, 'loader.js'))) process.exit(0);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('monaco → public/monaco/vs');
