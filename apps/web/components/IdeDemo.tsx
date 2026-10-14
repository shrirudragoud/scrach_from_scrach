'use client';

// The integration in one file: a Monaco editor with file tabs, the host's own store, and the block
// panel — what your IDE page would look like. The only package API used is the public one:
// useCodeBlocks() → handle, handle.setFiles / attachMonaco, <BlocksPanel blocks={handle} />.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlocksCanvasHandle } from '@codeblocks/konva';
import Editor, { loader } from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { BlocksPanel, useCodeBlocks } from '@codeblocks/react';
import '@codeblocks/react/styles.css';
import { useAppStore } from '../lib/store.ts';
import { SAMPLES } from '../lib/samples.ts';

// Self-hosted Monaco (copied to /public by `npm run assets`) — no CDN dependency.
loader.config({ paths: { vs: '/monaco/vs' } });

type MonacoEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];

export default function IdeDemo() {
  const { sampleId, files, main, activeFile, loadSample, setActiveFile, setFileContent } = useAppStore();
  const blocks = useCodeBlocks({ assetBase: '/codeblocks/', assetVersion: process.env.NEXT_PUBLIC_CODEBLOCKS_VERSION });

  const [mounted, setMounted] = useState<{ editor: MonacoEditor; monaco: MonacoApi } | null>(null);
  const pendingLine = useRef<number | null>(null);
  const canvasRef = useRef<BlocksCanvasHandle | null>(null);

  // Feed the whole project to the analyzer whenever a sample is (re)loaded.
  useEffect(() => {
    if (blocks) blocks.setFiles(useAppStore.getState().files, useAppStore.getState().main);
  }, [blocks, sampleId]);

  // Bind Monaco <-> block view (markers, line highlights, cursor sync, reveal).
  useEffect(() => {
    if (!blocks || !mounted) return;
    const binding = blocks.attachMonaco({
      editor: mounted.editor as never,
      monaco: mounted.monaco as never,
      openFile: (file, line) => { pendingLine.current = line; useAppStore.getState().setActiveFile(file); },
    });
    return () => binding.dispose();
  }, [blocks, mounted]);

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
    if (process.env.NEXT_PUBLIC_E2E && blocks) (window as unknown as Record<string, unknown>).__codeblocks = { blocks, store: { getState: () => ({ blocks: blocks.getState() }) }, canvas: canvasRef };
  }, [blocks]);

  const onMount: OnMount = useCallback((editor, monaco) => setMounted({ editor, monaco }), []);
  const file = files.find((f) => f.name === activeFile) ?? files[0];

  return (
    <main className="ide">
      <section className="pane blocks" aria-label="Block view">
        {blocks ? <BlocksPanel blocks={blocks} canvasRef={canvasRef} /> : null}
      </section>

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
    </main>
  );
}
