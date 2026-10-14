// @codeblocks/core — public API.
//
//   import Parser from 'web-tree-sitter';
//   configure({ Parser, grammars: { cpp: '/codeblocks/tree-sitter-cpp.wasm' } });
//   const { scene, diagnostics } = await analyzeProject(files, { mode: 'kids' });
//
// The engine is DOM-free and never imports web-tree-sitter itself, so it runs in a Worker, in Node
// (tests, CI, server) or on the main thread.

export { configure, preload, isConfigured } from './parser.ts';
export type { ParserConfig, ParserClassLike, SyntaxNode } from './parser.ts';
export { analyze, analyzeProject } from './analyze.ts';
export type { ProjectOptions } from './analyze.ts';
export { registerLanguage, getLanguage, supportedLanguages, languageForFile } from './registry.ts';
export { buildTour } from './graph/tour.ts';
export type { TourStep, TourOptions } from './graph/tour.ts';
export { findNodeAt } from './graph/query.ts';
export { buildScene } from './graph/layout.ts';
export { combineFiles, locate, mapLoc, toCombinedLine } from './project.ts';
export type { Segment, CombinedSource } from './project.ts';
export { KINDS, kindMeta } from './kinds.ts';
export { walkStmts } from './ir.ts';
export { extractProgram } from './lang/cfamily.ts';
export { arduino } from './profiles/arduino.ts';
export * from './types.ts';
