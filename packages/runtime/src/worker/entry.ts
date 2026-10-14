// Analyzer worker. Built by scripts/build-worker.mjs into a self-contained classic-worker script
// (core + web-tree-sitter inlined) that is served as a static file — no bundler plugin, no
// `new URL(..., import.meta.url)` magic, so it behaves identically under Next/webpack/Turbopack/Vite.

import Parser from 'web-tree-sitter';
import { AnalyzeError, analyzeProject, configure, preload } from '@codeblocks/core';
import type { WorkerRequest, WorkerResponse } from '../protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: WorkerResponse): void => self.postMessage(msg);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'init') {
      configure({ Parser: Parser as never, runtimeWasm: req.runtimeWasm, grammars: req.grammars });
      await preload('cpp');
      post({ id: req.id, ok: true, type: 'ready' });
      return;
    }
    const { scene, diagnostics, stats } = await analyzeProject(req.files, req.options);
    post({ id: req.id, ok: true, type: 'result', result: { scene, diagnostics, stats } });
  } catch (e) {
    const err = e instanceof AnalyzeError ? e : new AnalyzeError('internal', e instanceof Error ? e.message : String(e));
    post({ id: req.id, ok: false, error: { code: err.code, message: err.message } });
  }
};
