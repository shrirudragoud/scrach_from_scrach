'use client';

// React hooks. Both are React-19-StrictMode safe: nothing with side effects (workers, timers) is
// created during render — only inside effects that are cleaned up.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { BlocksController, blocksAdapter, createBlocksStore, createWorkerAnalyzer } from '@codeblocks/runtime';
import type { Analyzer, BlocksSlice, BlocksState, ControllerOptions, WorkerAnalyzerOptions } from '@codeblocks/runtime';

/** A standalone block-view store (use when you are not composing the slice into your app store). */
export function useBlocksStore(): StoreApi<BlocksSlice> {
  return useMemo(() => createBlocksStore(), []);
}

/** Subscribe to the block-view state held in any Zustand store that contains the `blocks` slice. */
export function useBlocksState<T extends BlocksSlice>(store: StoreApi<T>): BlocksState;
export function useBlocksState<T extends BlocksSlice, U>(store: StoreApi<T>, selector: (b: BlocksState) => U): U;
export function useBlocksState<T extends BlocksSlice, U>(store: StoreApi<T>, selector?: (b: BlocksState) => U): BlocksState | U {
  return useStore(store, (s: T) => (selector ? selector(s.blocks) : s.blocks));
}

export interface UseBlocksControllerOptions<T extends BlocksSlice> {
  store: Pick<StoreApi<T>, 'getState' | 'setState' | 'subscribe'>;
  /** Where the analyzer assets were copied (`codeblocks-assets public/codeblocks`). Default '/codeblocks/'. */
  assetBase?: string;
  /** Cache-buster for the worker/wasm URLs. */
  assetVersion?: string;
  /** Provide your own analyzer (tests, a shared worker, a server endpoint). */
  analyzer?: Analyzer;
  workerOptions?: WorkerAnalyzerOptions;
  controller?: Omit<ControllerOptions, 'analyzer' | 'state'>;
}

/**
 * Creates the analyzer + controller for the lifetime of the component and disposes them on unmount.
 * Returns null on the first render (and during SSR); render the panel once it is non-null.
 */
export function useBlocksController<T extends BlocksSlice>(opts: UseBlocksControllerOptions<T>): BlocksController | null {
  const [controller, setController] = useState<BlocksController | null>(null);
  const { store, assetBase, assetVersion, analyzer, workerOptions, controller: controllerOptions } = opts;

  useEffect(() => {
    const a = analyzer ?? createWorkerAnalyzer({ assetBase, version: assetVersion, ...workerOptions });
    const c = new BlocksController({
      analyzer: a,
      state: blocksAdapter(store as StoreApi<T>),
      validate: process.env.NODE_ENV !== 'production',
      onWarn: (m, d) => console.warn('[codeblocks]', m, d),
      ...controllerOptions,
    });
    setController(c);
    void c.warmUp();
    return () => {
      c.dispose();
      setController(null);
    };
    // The options object is expected to be stable (module constant / memoised); re-creating the
    // controller on every render would restart the worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, assetBase, assetVersion, analyzer]);

  return controller;
}
