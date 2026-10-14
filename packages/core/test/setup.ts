import { createRequire } from 'node:module';
import path from 'node:path';
import Parser from 'web-tree-sitter';
import { configure } from '../src/index.ts';

const require = createRequire(import.meta.url);
const wasmDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');

/** Wire web-tree-sitter + the bundled C/C++ grammars for Node-based tests and scripts. */
export function configureNode(): void {
  configure({
    Parser: Parser as never,
    grammars: { cpp: path.join(wasmDir, 'tree-sitter-cpp.wasm'), c: path.join(wasmDir, 'tree-sitter-c.wasm') },
  });
}
