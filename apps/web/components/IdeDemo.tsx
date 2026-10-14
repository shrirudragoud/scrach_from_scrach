'use client';

// The integration in one file: a Monaco editor with file tabs, a Zustand store with the block view
// composed in as a slice, and the Konva block panel — what your IDE page would look like.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlocksCanvasHandle } from '@codeblocks/konva';
import Editor, { loader } from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { BlocksPanel, useBlocksController, useBlocksState } from '@codeblocks/react';
import { blocksAdapter } from '@codeblocks/runtime';
import { attachMonaco } from '@codeblocks/runtime/monaco';
import '@codeblocks/react/styles.css';
import { useAppStore } from '../lib/store.ts';
import { SAMPLES } from '../lib/samples.ts';

// Self-hosted Monaco (copied to /public by `npm run assets`) — no CDN dependency.
loader.config({ paths: { vs: '/monaco/vs' } });

type MonacoEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];

export default function IdeDemo() {
  const { sampleId, files, main, activeFile, loadSample, setActiveFile, setFileContent } = useAppStore();
  const blocks = useBlocksState(useAppStore);
  const controller = useBlocksController({ store: useAppStore, assetBase: '/codeblocks/', assetVersion: process.env.NEXT_PUBLIC_CODEBLOCKS_VERSION });

  const [mounted, setMounted] = useState<{ editor: MonacoEditor; monaco: MonacoApi } | null>(null);
  const pendingLine = useRef<number | null>(null);
  const canvasRef = useRef<BlocksCanvasHandle | null>(null);

  // Feed the whole project to the analyzer whenever a sample is (re)loaded.
  useEffect(() => {
    if (controller) controller.setFiles(useAppStore.getState().files, useAppStore.getState().main);
  }, [controller, sampleId]);

  // Bind Monaco <-> controller (markers, line highlights, cursor sync, reveal).
  useEffect(() => {
    if (!controller || !mounted) return;
    const binding = attachMonaco({
      controller,
      state: blocksAdapter(useAppStore),
      editor: mounted.editor as never,
      monaco: mounted.monaco as never,
      openFile: (file, line) => { pendingLine.current = line; useAppStore.getState().setActiveFile(file); },
    });
    return () => binding.dispose();
  }, [controller, mounted]);

  // After a block in another tab asked us to open it, scroll to its line once the model switched.
  useEffect(() => {
    if (pendingLine.current != null && mounted) {
      const line = pendingLine.current;
      pendingLine.current = null;
      requestAnimationFrame(() => mounted.editor.revealLineInCenter(line));
    }
  }, [activeFile, mounted]);

  // Test/debug handle (only when asked for).
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E && controller) (window as unknown as Record<string, unknown>).__codeblocks = { controller, store: useAppStore, canvas: canvasRef };
  }, [controller]);

  const onMount: OnMount = useCallback((editor, monaco) => setMounted({ editor, monaco }), []);
  const file = files.find((f) => f.name === activeFile) ?? files[0];

  return (
    <main className="ide">
      <section className="pane" aria-label="Code editor">
        <div className="pane-head">
          <div className="brand"><span className="logo">🧩</span>Code → Blocks</div>
          <select value={sampleId} onChange={(e) => loadSample(e.target.value)} aria-label="Example sketch" data-testid="sample-select">
            {Object.entries(SAMPLES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
        </div>
        <div className="tabs" role="tablist">
          {files.map((f) => (
            <button key={f.name} role="tab" aria-selected={f.name === activeFile} className={`tab${f.name === activeFile ? ' on' : ''}`} onClick={() => setActiveFile(f.name)} data-testid={`tab-${f.name}`}>
              {f.name}{f.name === main ? ' ★' : ''}
            </button>
          ))}
        </div>
        <div className="editor" data-testid="editor">
          <Editor
            key={sampleId}
            height="100%"
            language="cpp"
            path={file.name}
            defaultValue={file.content}
            onChange={(v) => setFileContent(file.name, v ?? '')}
            onMount={onMount}
            options={{ minimap: { enabled: false }, fontSize: 14, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, padding: { top: 12 } }}
          />
        </div>
      </section>

      <section className="pane blocks" aria-label="Block view">
        {controller ? <BlocksPanel controller={controller} state={blocks} canvasRef={canvasRef} /> : null}
      </section>
    </main>
  );
}
