import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// `npm run assets` writes the worker/wasm version here; it busts caches when the engine changes.
const versionFile = path.join(import.meta.dirname, 'public/codeblocks/version.txt');
const codeblocksVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'dev';

const config: NextConfig = {
  env: { NEXT_PUBLIC_CODEBLOCKS_VERSION: codeblocksVersion },
  reactStrictMode: true,
  // The workspace packages ship TypeScript source; Next compiles them like app code.
  transpilePackages: ['@codeblocks/core', '@codeblocks/runtime', '@codeblocks/konva', '@codeblocks/react'],
  // Monorepo: node_modules are hoisted to the repo root.
  turbopack: { root: path.join(import.meta.dirname, '../..') },
  // konva's optional node `canvas` dependency must never be bundled for the browser (webpack builds).
  webpack: (cfg) => {
    cfg.resolve.alias = { ...cfg.resolve.alias, canvas: false };
    return cfg;
  },
  async headers() {
    return [
      // Worker + wasm are versioned with ?v=…, so they can be cached hard.
      { source: '/codeblocks/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default config;
