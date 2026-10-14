// State shape and the store contract.
//
// The controller only needs the tiny StateAdapter interface, so it works with any store: the built-in
// in-memory one (createMemoryAdapter, the default), your own store (write a 3-method adapter), or
// Zustand (see '@codeblocks/runtime/zustand').

import type { Diagnostic, AnalyzeStats, Scene, SceneMode, TextMetrics } from '@codeblocks/core';

export type BlocksStatus = 'idle' | 'analyzing' | 'ready' | 'error';

export interface BlocksError {
  code: string;
  message: string;
}

export interface BlocksState {
  status: BlocksStatus;
  /** Last successfully drawn scene. Kept while a newer analysis runs or fails (`stale`). */
  scene: Scene | null;
  stale: boolean;
  diagnostics: Diagnostic[];
  stats: AnalyzeStats | null;
  error: BlocksError | null;
  mode: SceneMode;
  showCode: boolean;
  metrics: Partial<TextMetrics> | undefined;
  selectedId: string | null;
  runningId: string | null;
  runningEdgeId: string | null;
  playing: boolean;
}

export interface BlocksSlice {
  blocks: BlocksState;
}

export const initialBlocksState: BlocksState = {
  status: 'idle',
  scene: null,
  stale: false,
  diagnostics: [],
  stats: null,
  error: null,
  mode: 'kids',
  showCode: true,
  metrics: undefined,
  selectedId: null,
  runningId: null,
  runningEdgeId: null,
  playing: false,
};

/** What the controller needs from a store. */
export interface StateAdapter {
  get(): BlocksState;
  patch(partial: Partial<BlocksState>): void;
  subscribe(listener: (state: BlocksState, prev: BlocksState) => void): () => void;
}

/** Dependency-free store: the default when the host does not bring its own. */
export function createMemoryAdapter(initial: Partial<BlocksState> = {}): StateAdapter {
  let state: BlocksState = { ...initialBlocksState, ...initial };
  const listeners = new Set<(s: BlocksState, p: BlocksState) => void>();
  return {
    get: () => state,
    patch(partial) {
      const prev = state;
      state = { ...state, ...partial };
      for (const l of [...listeners]) l(state, prev);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
