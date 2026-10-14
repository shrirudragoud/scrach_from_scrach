// Thin wrapper around web-tree-sitter. The Parser class and wasm locations are injected, so the engine
// itself never imports web-tree-sitter (which is UMD/CJS and not bundler-friendly): the worker entry
// or a Node script does the import and calls configure().

import { AnalyzeError } from './types.ts';

/** The subset of web-tree-sitter's SyntaxNode the adapters use. */
export interface SyntaxNode {
  id: number;
  type: string;
  text: string;
  isNamed: boolean;
  isMissing: boolean;
  hasError: boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  namedChild(i: number): SyntaxNode | null;
  childForFieldName(name: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
}

interface TreeLike {
  rootNode: SyntaxNode;
  delete(): void;
}

interface ParserLike {
  setLanguage(lang: unknown): void;
  parse(source: string): TreeLike;
}

export interface ParserClassLike {
  new (): ParserLike;
  init(opts?: { locateFile?: (name: string) => string }): Promise<void>;
  Language: { load(src: string | Uint8Array): Promise<unknown> };
}

export interface ParserConfig {
  Parser: ParserClassLike;
  /** URL/path of tree-sitter.wasm when it is not next to the JS file. */
  runtimeWasm?: string;
  /** grammar name → URL/path/bytes of its .wasm (e.g. `{ cpp: '/codeblocks/tree-sitter-cpp.wasm' }`). */
  grammars: Record<string, string | Uint8Array>;
}

let config: ParserConfig | null = null;
let initPromise: Promise<void> | null = null;
const languages = new Map<string, unknown>();
const parsers = new Map<string, ParserLike>();

export function configure(next: ParserConfig): void {
  if (config && config.Parser !== next.Parser) {
    languages.clear();
    parsers.clear();
    initPromise = null;
  }
  config = { ...next, grammars: { ...(config?.grammars ?? {}), ...next.grammars } };
}

export const isConfigured = (): boolean => config !== null;

async function init(): Promise<ParserConfig> {
  if (!config) throw new AnalyzeError('parser-unavailable', 'code-blocks: call configure({ Parser, grammars }) before analyzing');
  const cfg = config;
  initPromise ??= cfg.Parser.init(cfg.runtimeWasm ? { locateFile: () => cfg.runtimeWasm as string } : undefined);
  await initPromise;
  return cfg;
}

async function parserFor(grammar: string): Promise<ParserLike> {
  const cfg = await init();
  const cached = parsers.get(grammar);
  if (cached) return cached;
  const src = cfg.grammars[grammar];
  if (!src) throw new AnalyzeError('parser-unavailable', `code-blocks: no wasm configured for grammar "${grammar}"`);
  if (!languages.has(grammar)) languages.set(grammar, await cfg.Parser.Language.load(src));
  const parser = new cfg.Parser();
  parser.setLanguage(languages.get(grammar));
  parsers.set(grammar, parser);
  return parser;
}

/** Parse `source`, run `fn(root)` while the tree is alive, then free the wasm tree (no leaks). */
export async function withTree<T>(grammar: string, source: string, fn: (root: SyntaxNode) => T): Promise<T> {
  const parser = await parserFor(grammar);
  const tree = parser.parse(source);
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** Warm the runtime + a grammar so the first real analysis is fast. */
export async function preload(grammar: string): Promise<void> {
  await parserFor(grammar);
}
