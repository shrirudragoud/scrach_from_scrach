// State shape + Zustand integration.
//
// The block view keeps all of its state under ONE key (`blocks`) so it composes into an existing
// app store without colliding with anything:
//
//   const useApp = create<AppState & BlocksSlice>()((...a) => ({ ...createAppSlice(...a), ...createBlocksSlice(...a) }));
//   const controller = new BlocksController({ analyzer, state: blocksAdapter(useApp) });
//
// The controller itself only needs the tiny StateAdapter interface, so any other store works too.

import { createStore } from 'zustand/vanilla';
import type { StateCreator, StoreApi } from 'zustand/vanilla';
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

/** Zustand slice: `{ blocks }`. */
export const createBlocksSlice = <T extends BlocksSlice>(): StateCreator<T, [], [], BlocksSlice> => () => ({ blocks: { ...initialBlocksState } });

/** Standalone store (when the host app does not want to compose a slice). */
export const createBlocksStore = (): StoreApi<BlocksSlice> => createStore<BlocksSlice>()(createBlocksSlice<BlocksSlice>());

/** Adapt any Zustand store that contains the `blocks` slice. */
export function blocksAdapter<T extends BlocksSlice>(api: Pick<StoreApi<T>, 'getState' | 'setState' | 'subscribe'>): StateAdapter {
  return {
    get: () => api.getState().blocks,
    patch: (partial) => api.setState((s) => ({ blocks: { ...s.blocks, ...partial } }) as Partial<T>),
    subscribe: (listener) => api.subscribe((s, p) => { if (s.blocks !== p.blocks) listener(s.blocks, p.blocks); }),
  };
}
