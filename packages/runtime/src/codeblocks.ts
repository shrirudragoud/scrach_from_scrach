// createCodeBlocks — the one object a host IDE holds on to.
//
//   const blocks = createCodeBlocks({ assetBase: '/codeblocks/' });
//   blocks.setFiles(project.files, 'main.ino');          // or updateFile() on every edit
//   blocks.attachMonaco({ editor, monaco, openFile });   // optional
//   blocks.subscribe((state) => …);                       // any UI (the React panel, your own, an agent)
//   blocks.dispose();
//
// It is headless: no DOM, no React, no store library. Nothing starts (no worker, no timers) until
// the first file arrives or warmUp() is called, so constructing it during render or SSR is harmless.

import type { ProjectFile, SceneMode, TextMetrics } from '@codeblocks/core';
import { createWorkerAnalyzer } from './analyzer.ts';
import type { Analyzer, WorkerAnalyzerOptions } from './analyzer.ts';
import { BlocksController } from './controller.ts';
import type { ControllerOptions, RevealListener } from './controller.ts';
import { attachMonaco } from './monaco.ts';
import type { AttachMonacoOptions, MonacoBinding } from './monaco.ts';
import { createMemoryAdapter } from './store.ts';
import type { BlocksError, BlocksState, StateAdapter } from './store.ts';

export interface CodeBlocksOptions {
  /** Where the analyzer assets were copied (`codeblocks-assets <dir>`). Default '/codeblocks/'. */
  assetBase?: string;
  /** Cache-buster for the worker/wasm URLs (contents of version.txt). */
  assetVersion?: string;
  workerOptions?: WorkerAnalyzerOptions;
  /** Bring your own analyzer (tests, a shared worker, a server endpoint). Default: the bundled worker. */
  analyzer?: Analyzer;
  /** Bring your own store (see StateAdapter / '@codeblocks/runtime/zustand'). Default: in-memory. */
  state?: StateAdapter;
  /** Dev-time structural validation of every scene. Default: on unless NODE_ENV === 'production'. */
  validate?: boolean;
  /** Analysis failures (also readable from state.error). */
  onError?: (error: BlocksError) => void;
  onWarn?: (message: string, detail?: unknown) => void;
  controller?: Pick<ControllerOptions, 'language' | 'main' | 'debounceMs' | 'tourIntervalMs'>;
}

export interface CodeBlocks {
  /** Escape hatch for advanced hosts; everything common is on the handle itself. */
  readonly controller: BlocksController;
  getState(): BlocksState;
  /** Called on every state change. Returns the unsubscribe function. */
  subscribe(listener: (state: BlocksState, prev: BlocksState) => void): () => void;

  setFiles(files: ProjectFile[], main?: string): void;
  updateFile(name: string, content: string): void;
  removeFile(name: string): void;
  setMain(name: string): void;
  setOptions(p: { mode?: SceneMode; showCode?: boolean; metrics?: Partial<TextMetrics> }): void;

  select(id: string | null, opts?: { reveal?: boolean }): void;
  selectByLocation(file: string, line: number): void;
  play(): void;
  stop(): void;
  togglePlay(): void;
  /** Fires when a block asks the editor to show its source (click, or the guided run). */
  onReveal(listener: RevealListener): () => void;

  /** Two-way binding with a Monaco editor. Disposed automatically with the handle. */
  attachMonaco(opts: Omit<AttachMonacoOptions, 'controller' | 'state'>): MonacoBinding;

  /** Resolves when the analysis currently scheduled has been applied. */
  flush(): Promise<void>;
  /** Start loading the parser early (e.g. when the panel is about to open). Never rejects. */
  warmUp(): Promise<void>;
  readonly disposed: boolean;
  /** Stops timers, terminates the worker, detaches editors. Safe to call twice. */
  dispose(): void;
}

export function createCodeBlocks(options: CodeBlocksOptions = {}): CodeBlocks {
  const state = options.state ?? createMemoryAdapter();
  const analyzer = options.analyzer ?? createWorkerAnalyzer({ assetBase: options.assetBase, version: options.assetVersion, ...options.workerOptions });
  const controller = new BlocksController({
    ...options.controller,
    analyzer,
    state,
    validate: options.validate ?? (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production'),
    onWarn: options.onWarn ?? ((m, d) => console.warn('[codeblocks]', m, d)),
    onError: options.onError,
  });
  const bindings = new Set<MonacoBinding>();
  let disposed = false;

  return {
    controller,
    getState: () => state.get(),
    subscribe: (l) => state.subscribe(l),
    setFiles: (files, main) => controller.setFiles(files, main),
    updateFile: (n, c) => controller.updateFile(n, c),
    removeFile: (n) => controller.removeFile(n),
    setMain: (n) => controller.setMain(n),
    setOptions: (p) => controller.setOptions(p),
    select: (id, o) => controller.select(id, o),
    selectByLocation: (f, l) => controller.selectByLocation(f, l),
    play: () => controller.play(),
    stop: () => controller.stopTour(),
    togglePlay: () => controller.togglePlay(),
    onReveal: (l) => controller.onReveal(l),
    attachMonaco(opts) {
      const b = attachMonaco({ ...opts, controller, state });
      const wrapped: MonacoBinding = {
        sync: () => b.sync(),
        dispose: () => { if (bindings.delete(wrapped)) b.dispose(); },
      };
      bindings.add(wrapped);
      return wrapped;
    },
    flush: () => controller.flush(),
    warmUp: () => controller.warmUp(),
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of [...bindings]) b.dispose();
      controller.dispose();
    },
  };
}
