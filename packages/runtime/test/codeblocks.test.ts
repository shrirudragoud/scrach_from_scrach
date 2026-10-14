import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AnalyzeError } from '@codeblocks/core';
import { createCodeBlocks, createMemoryAdapter, initialBlocksState } from '../src/index.ts';
import type { Analyzer, CodeBlocks } from '../src/index.ts';
import type { EditorLike, ModelLike, MonacoLike } from '../src/monaco.ts';
import { createNodeAnalyzer } from '../src/node.ts';
import { blocksAdapter, createBlocksStore } from '../src/zustand.ts';

const BLINK = 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000);\n}\n';

let analyzer: Analyzer;
beforeAll(() => { analyzer = createNodeAnalyzer(); });

const open: CodeBlocks[] = [];
afterEach(() => { for (const h of open.splice(0)) h.dispose(); });
const make = (o: Parameters<typeof createCodeBlocks>[0] = {}): CodeBlocks => {
  const h = createCodeBlocks({ analyzer, controller: { debounceMs: 0 }, validate: true, onWarn: (m) => { throw new Error(m); }, ...o });
  open.push(h);
  return h;
};

describe('createCodeBlocks', () => {
  it('is inert until used: constructing without a Worker (SSR, render) does nothing and disposes cleanly', () => {
    const h = createCodeBlocks();
    expect(h.getState()).toEqual(initialBlocksState);
    h.dispose();
    h.dispose();
    expect(h.disposed).toBe(true);
  });

  it('analyses a project and publishes it through subscribe()', async () => {
    const h = make();
    const seen: string[] = [];
    const off = h.subscribe((s) => seen.push(s.status));
    h.setFiles([{ name: 'a.ino', content: BLINK }], 'a.ino');
    await h.flush();
    expect(h.getState().status).toBe('ready');
    expect(h.getState().scene?.nodes.length).toBeGreaterThan(3);
    expect(seen).toContain('analyzing');
    expect(seen.at(-1)).toBe('ready');
    off();
    const n = seen.length;
    h.updateFile('a.ino', 'void loop() { delay(1); }');
    await h.flush();
    expect(seen.length).toBe(n);
  });

  it('reports failures through onError and keeps the last good scene', async () => {
    let fail = false;
    const flaky: Analyzer = {
      analyze: async (req) => { if (fail) throw new AnalyzeError('too-large', 'too big'); return analyzer.analyze(req); },
      warmUp: async () => {},
      dispose: () => {},
    };
    const errors: string[] = [];
    const h = make({ analyzer: flaky, onError: (e) => errors.push(e.code) });
    h.setFiles([{ name: 'a.ino', content: BLINK }]);
    await h.flush();
    fail = true;
    h.updateFile('a.ino', 'void loop() {}');
    await h.flush();
    expect(errors).toEqual(['too-large']);
    expect(h.getState()).toMatchObject({ status: 'error', stale: true, error: { code: 'too-large' } });
    expect(h.getState().scene).not.toBeNull();
  });

  it('does nothing after dispose (no analysis, no state change, no throw)', async () => {
    const spy = vi.spyOn(analyzer, 'analyze');
    const h = createCodeBlocks({ analyzer, controller: { debounceMs: 0 } });
    h.dispose();
    spy.mockClear();
    h.setFiles([{ name: 'a.ino', content: BLINK }]);
    h.updateFile('a.ino', 'x');
    h.play();
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
    expect(h.getState().status).toBe('idle');
    spy.mockRestore();
  });

  it('StrictMode-style double mount: first handle disposed, second works independently', async () => {
    const first = make();
    first.dispose();
    const second = make();
    second.setFiles([{ name: 'a.ino', content: BLINK }]);
    await second.flush();
    expect(second.getState().status).toBe('ready');
    expect(first.getState().status).toBe('idle');
  });

  it('the in-memory store and the Zustand store behave identically', async () => {
    const zs = createBlocksStore();
    const a = make();
    const b = make({ state: blocksAdapter(zs) });
    for (const h of [a, b]) {
      h.setFiles([{ name: 'a.ino', content: BLINK }]);
      await h.flush();
      h.selectByLocation('a.ino', 7);
    }
    const strip = (s: ReturnType<CodeBlocks['getState']>) => ({ ...s, stats: s.stats && { ...s.stats, ms: 0 } });
    expect(strip(zs.getState().blocks)).toEqual(strip(a.getState()));
    expect(a.getState().selectedId).not.toBeNull();
  });

  it('accepts a host-provided adapter (any store with get/patch/subscribe)', async () => {
    const mem = createMemoryAdapter();
    const patches: string[] = [];
    const h = make({ state: { get: mem.get, subscribe: mem.subscribe, patch: (p) => { patches.push(Object.keys(p).join()); mem.patch(p); } } });
    h.setFiles([{ name: 'a.ino', content: BLINK }]);
    await h.flush();
    expect(patches.length).toBeGreaterThan(0);
    expect(mem.get().scene).not.toBeNull();
  });

  it('play/stop run the guided tour and report reveals', async () => {
    try {
      const h = make({ controller: { debounceMs: 0, tourIntervalMs: 10 } });
      h.setFiles([{ name: 'a.ino', content: BLINK }]);
      await h.flush();
      vi.useFakeTimers();
      const reveals: number[] = [];
      h.onReveal((loc) => reveals.push(loc.start));
      h.play();
      expect(h.getState().playing).toBe(true);
      vi.advanceTimersByTime(35);
      expect(reveals.length).toBeGreaterThan(1);
      h.stop();
      expect(h.getState()).toMatchObject({ playing: false, runningId: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

function fakeEditor() {
  const model: ModelLike & { value: string } = { uri: { path: '/p/a.ino' }, value: BLINK, getValue() { return this.value; }, getLineMaxColumn: () => 80 };
  const content: (() => void)[] = [];
  let cleared = 0;
  const editor: EditorLike = {
    getModel: () => model,
    onDidChangeModelContent: (cb) => { content.push(cb); return { dispose: () => content.splice(content.indexOf(cb), 1) }; },
    onDidChangeModel: () => ({ dispose: () => {} }),
    onDidChangeCursorPosition: () => ({ dispose: () => {} }),
    revealLineInCenterIfOutsideViewport: () => {},
    createDecorationsCollection: () => ({ set: () => {}, clear: () => { cleared++; } }),
  };
  const monaco: MonacoLike = { editor: { setModelMarkers: () => {} }, MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 } };
  return { editor, monaco, model, listeners: content, get cleared() { return cleared; } };
}

describe('handle.attachMonaco', () => {
  it('feeds editor edits to the analysis, and disposing the handle detaches the editor', async () => {
    const h = make();
    const e = fakeEditor();
    h.attachMonaco({ editor: e.editor, monaco: e.monaco });
    await h.flush();
    e.model.value = 'void loop(){ delay(9); }';
    e.listeners.forEach((l) => l());
    await h.flush();
    expect(h.getState().scene?.nodes.some((n) => n.titleLines.join(' ') === 'Wait 9 milliseconds')).toBe(true);
    h.dispose();
    expect(e.listeners).toHaveLength(0);
    expect(e.cleared).toBe(1);
  });

  it('disposing a binding twice (or after the handle) is harmless', () => {
    const h = make();
    const e = fakeEditor();
    const b = h.attachMonaco({ editor: e.editor, monaco: e.monaco });
    b.dispose();
    b.dispose();
    h.dispose();
    expect(e.cleared).toBe(1);
  });
});
