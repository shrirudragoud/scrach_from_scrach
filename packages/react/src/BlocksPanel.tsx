'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, Ref } from 'react';
import { BlocksCanvas, defaultTheme, loadThemeFonts, measureTextMetrics } from '@codeblocks/konva';
import type { BlocksCanvasHandle, BlocksTheme } from '@codeblocks/konva';
import type { CodeBlocks } from '@codeblocks/runtime';
import { CanvasBoundary } from './CanvasBoundary.tsx';
import { useBlocksState } from './hooks.ts';
import { defaultLabels } from './labels.ts';
import type { PanelLabels } from './labels.ts';

export interface BlocksPanelProps {
  /** The handle from `useCodeBlocks()` / `createCodeBlocks()`. */
  blocks: CodeBlocks;
  theme?: BlocksTheme;
  labels?: Partial<PanelLabels>;
  /** Hide parts of the chrome. */
  features?: { toolbar?: boolean; explain?: boolean; zoomButtons?: boolean };
  /** Receives the PNG data URL; default downloads `my-blocks.png`. */
  onExportPng?: (dataUrl: string) => void;
  /** Imperative handle to the canvas (fit, zoom, centre on a block, export PNG). */
  canvasRef?: Ref<BlocksCanvasHandle>;
  /** A rendering error was caught and replaced by a notice; report it to your logging. */
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
}

function download(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

export function BlocksPanel({ blocks, theme = defaultTheme, labels, features, onExportPng, canvasRef, onError, className, style }: BlocksPanelProps) {
  const state = useBlocksState(blocks);
  const L = useMemo<PanelLabels>(() => ({ ...defaultLabels, ...labels }), [labels]);
  const f = { toolbar: true, explain: true, zoomButtons: true, ...features };
  const canvas = useRef<BlocksCanvasHandle | null>(null);
  const setCanvas = useCallback((h: BlocksCanvasHandle | null) => {
    canvas.current = h;
    if (typeof canvasRef === 'function') canvasRef(h);
    else if (canvasRef) (canvasRef as { current: BlocksCanvasHandle | null }).current = h;
  }, [canvasRef]);

  // Lay the blocks out with the *real* width of the fonts this machine will draw them with.
  useEffect(() => {
    let alive = true;
    void loadThemeFonts(theme).then(() => {
      const metrics = measureTextMetrics(theme);
      if (alive && metrics) blocks.setOptions({ metrics });
    });
    return () => { alive = false; };
  }, [blocks, theme]);

  const selected = state.selectedId && state.scene ? state.scene.nodes.find((n) => n.id === state.selectedId) ?? null : null;
  const errors = state.diagnostics.length;

  const status = state.status === 'analyzing' ? L.thinking : errors ? L.typos(errors) : state.stats ? L.blocksCount(state.stats.nodes, state.stats.ms) : '';
  const statusTone = state.status === 'error' || errors ? 'bad' : 'ok';

  const savePng = useCallback(() => {
    const url = canvas.current?.toDataURL();
    if (!url) return;
    if (onExportPng) onExportPng(url); else download(url, 'my-blocks.png');
  }, [onExportPng]);

  const empty = state.scene !== null && state.scene.nodes.length === 0;

  return (
    <section className={`cb-panel${className ? ` ${className}` : ''}`} style={style} data-testid="blocks-panel" data-status={state.status}>
      <div className="cb-canvas">
        <CanvasBoundary resetKey={state.scene} message={L.crashed} retryLabel={L.retry} onError={onError}>
          <BlocksCanvas
            ref={setCanvas}
            scene={state.scene}
            selectedId={state.selectedId}
            runningId={state.runningId}
            runningEdgeId={state.runningEdgeId}
            theme={theme}
            topInset={f.toolbar ? 104 : 0}
            stale={state.stale && state.status !== 'ready'}
            onSelect={(id, { reveal }) => blocks.select(id, { reveal })}
          />
        </CanvasBoundary>
      </div>

      {empty && <div className="cb-empty">{L.noCode}</div>}

      <div className="cb-chips">
        {status && <span className={`cb-chip ${statusTone}`} role="status" data-testid="blocks-status">{status}</span>}
        {state.stale && state.status === 'error' && <span className="cb-chip bad">{L.stale}</span>}
      </div>

      {state.status === 'error' && state.error && (
        <div className="cb-error" role="alert">
          <strong>{L.errorTitle}</strong>
          <span>{state.error.message}</span>
        </div>
      )}

      {f.toolbar && (
        <div className="cb-toolbar" role="toolbar" aria-label="Block view controls">
          <button type="button" className={`cb-primary${state.playing ? ' cb-stop' : ''}`} onClick={() => blocks.togglePlay()} disabled={!state.scene?.nodes.length} data-testid="blocks-play">
            {state.playing ? L.stop : L.play}
          </button>
          <label className="cb-tog">
            <input type="checkbox" checked={state.showCode} onChange={(e) => blocks.setOptions({ showCode: e.target.checked })} />
            {L.realCode}
          </label>
          <button type="button" onClick={() => canvas.current?.fit()}>{L.fit}</button>
          <button type="button" onClick={savePng} disabled={!state.scene?.nodes.length}>{L.savePng}</button>
        </div>
      )}

      {f.zoomButtons && (
        <div className="cb-zoom">
          <button type="button" aria-label={L.zoomOut} onClick={() => canvas.current?.zoomBy(0.8)}>−</button>
          <button type="button" aria-label={L.zoomIn} onClick={() => canvas.current?.zoomBy(1.25)}>+</button>
          <button type="button" aria-label={L.fit} onClick={() => canvas.current?.fit()}>⤢</button>
        </div>
      )}

      {f.explain && (
        <div className="cb-explain" aria-live="polite" data-testid="blocks-explain">
          <div className="cb-em" aria-hidden="true">{selected?.emoji ?? '👆'}</div>
          <div>
            <h3>{selected ? selected.titleLines.join(' ') : L.hintTitle}</h3>
            <p>{selected ? selected.explain : L.hintText}</p>
            {selected?.text && <code>{selected.text.replace(/\s+/g, ' ').slice(0, 160)}</code>}
            {selected?.warn && <div className="cb-warn">⚠️ {selected.warn}</div>}
          </div>
        </div>
      )}
    </section>
  );
}
