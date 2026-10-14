// Node-side analyzer (tests, CI, server rendering): same Analyzer interface, no worker.
import { createRequire } from 'node:module';
import path from 'node:path';
import Parser from 'web-tree-sitter';
import { analyzeProject, configure } from '@codeblocks/core';
import type { Analyzer, AnalyzeRequest } from './analyzer.ts';

export function createNodeAnalyzer(): Analyzer {
  const require = createRequire(import.meta.url);
  const wasmDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  configure({ Parser: Parser as never, grammars: { cpp: path.join(wasmDir, 'tree-sitter-cpp.wasm') } });
  let seq = 0;
  return {
    async analyze(req: AnalyzeRequest) {
      const mine = ++seq;
      const { program: _program, ...wire } = await analyzeProject(req.files, req.options);
      return mine === seq ? wire : null;
    },
    async warmUp() {},
    dispose() {},
  };
}
