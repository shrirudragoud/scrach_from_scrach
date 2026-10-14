'use client';

// React bindings for the headless handle. Nothing with side effects (workers, timers) is created
// during render — only inside effects that are cleaned up, so React 18/19 StrictMode's
// mount → unmount → mount cycle just creates and disposes one idle handle.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createCodeBlocks, initialBlocksState } from '@codeblocks/runtime';
import type { BlocksState, CodeBlocks, CodeBlocksOptions } from '@codeblocks/runtime';

/**
 * Creates a handle for the lifetime of the component and disposes it on unmount.
 * Returns null on the first render and during SSR; render the panel once it is non-null.
 *
 * Re-created only when `assetBase`, `assetVersion`, `analyzer` or `state` change. Callbacks
 * (`onError`, `onWarn`) may change freely — the latest ones are always used.
 */
export function useCodeBlocks(options: CodeBlocksOptions = {}): CodeBlocks | null {
  const [handle, setHandle] = useState<CodeBlocks | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { assetBase, assetVersion, analyzer, state } = options;

  useEffect(() => {
    const h = createCodeBlocks({
      ...latest.current,
      onError: (e) => latest.current.onError?.(e),
      onWarn: latest.current.onWarn ? (m, d) => latest.current.onWarn?.(m, d) : undefined,
    });
    setHandle(h);
    void h.warmUp();
    return () => {
      h.dispose();
      setHandle(null);
    };
  }, [assetBase, assetVersion, analyzer, state]);

  return handle;
}

/**
 * Subscribe to the block-view state. With a selector, return a primitive or an existing object from
 * the state (never a freshly built one), otherwise React will re-render in a loop.
 */
export function useBlocksState(handle: CodeBlocks | null): BlocksState;
export function useBlocksState<U>(handle: CodeBlocks | null, selector: (s: BlocksState) => U): U;
export function useBlocksState<U>(handle: CodeBlocks | null, selector?: (s: BlocksState) => U): BlocksState | U {
  const get = (): BlocksState => (handle ? handle.getState() : initialBlocksState);
  const snapshot = (): BlocksState | U => (selector ? selector(get()) : get());
  return useSyncExternalStore(
    (notify) => (handle ? handle.subscribe(() => notify()) : () => undefined),
    snapshot,
    () => (selector ? selector(initialBlocksState) : initialBlocksState),
  );
}
