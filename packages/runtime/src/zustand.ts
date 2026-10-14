// Optional Zustand integration (`import … from '@codeblocks/runtime/zustand'`). Needs `zustand` ≥ 5.
//
// The block view keeps all of its state under ONE key (`blocks`) so it composes into an existing
// app store without colliding with anything:
//
//   const useApp = create<AppState & BlocksSlice>()((...a) => ({ ...createAppSlice(...a), ...createBlocksSlice<AppState>()(...a) }));
//   const blocks = createCodeBlocks({ state: blocksAdapter(useApp) });

import { createStore } from 'zustand/vanilla';
import type { StateCreator, StoreApi } from 'zustand/vanilla';
import { initialBlocksState } from './store.ts';
import type { BlocksSlice, StateAdapter } from './store.ts';

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
