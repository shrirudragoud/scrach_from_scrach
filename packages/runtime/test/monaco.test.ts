import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BlocksController, blocksAdapter, createBlocksStore } from '../src/index.ts';
import { attachMonaco } from '../src/monaco.ts';
import type { EditorLike, ModelLike, MonacoLike } from '../src/monaco.ts';
import { createNodeAnalyzer } from '../src/node.ts';
import type { Analyzer } from '../src/index.ts';

const BLINK = 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000);\n}\n';
let analyzer: Analyzer;
beforeAll(() => { analyzer = createNodeAnalyzer(); });
afterEach(() => { vi.useRealTimers(); });

function fakeModel(path: string, value: string): ModelLike & { value: string } {
  return { uri: { path }, value, getValue() { return this.value; }, getLineMaxColumn: (l: number) => 80 + l };
}

function fakeMonaco() {
  const markers = new Map<string, unknown[]>();
  const api: MonacoLike & { markers: typeof markers } = {
    markers,
    editor: { setModelMarkers: (m, owner, list) => { markers.set(`${m.uri.path}:${owner}`, list); } },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  };
  return api;
}

function fakeEditor(initial: ReturnType<typeof fakeModel>) {
  let model = initial;
  const handlers = { content: [] as (() => void)[], model: [] as (() => void)[], cursor: [] as ((e: { position: { lineNumber: number } }) => void)[] };
  const decos: unknown[][] = [];
  const revealed: number[] = [];
  let cleared = 0;
  const editor: EditorLike = {
    getModel: () => model,
    onDidChangeModelContent: (cb) => { handlers.content.push(cb); return { dispose: () => handlers.content.splice(handlers.content.indexOf(cb), 1) }; },
    onDidChangeModel: (cb) => { handlers.model.push(cb); return { dispose: () => handlers.model.splice(handlers.model.indexOf(cb), 1) }; },
    onDidChangeCursorPosition: (cb) => { handlers.cursor.push(cb); return { dispose: () => handlers.cursor.splice(handlers.cursor.indexOf(cb), 1) }; },
    revealLineInCenterIfOutsideViewport: (l) => { revealed.push(l); },
    createDecorationsCollection: () => ({ set: (d) => { decos.push(d); }, clear: () => { cleared++; } }),
  };
  return {
    editor, handlers, decos, revealed, get cleared() { return cleared; },
    type(value: string) { model.value = value; handlers.content.forEach((h) => h()); },
    moveCursor(line: number) { handlers.cursor.forEach((h) => h({ position: { lineNumber: line } })); },
    swapModel(m: ReturnType<typeof fakeModel>) { model = m; handlers.model.forEach((h) => h()); },
  };
}

function rig(extraFiles: { name: string; content: string }[] = []) {
  const store = createBlocksStore();
  const state = blocksAdapter(store);
  const controller = new BlocksController({ analyzer, state, debounceMs: 5 });
  const model = fakeModel('/project/a.ino', BLINK);
  const ed = fakeEditor(model);
  const monaco = fakeMonaco();
  const opened: [string, number][] = [];
  controller.setFiles([{ name: 'a.ino', content: BLINK }, ...extraFiles]);
  const binding = attachMonaco({ controller, state, editor: ed.editor, monaco, cursorDebounceMs: 0, openFile: (f, l) => opened.push([f, l]) });
  return { store, controller, ed, monaco, binding, model, opened, get: () => store.getState().blocks };
}

describe('attachMonaco', () => {
  it('pushes edits into the controller, which re-analyses', async () => {
    const r = rig();
    await r.controller.flush();
    r.ed.type('void loop(){ delay(42); }');
    await r.controller.flush();
    expect(r.get().scene?.nodes.some((n) => n.titleLines.join(' ') === 'Wait 42 milliseconds')).toBe(true);
    r.binding.dispose();
  });

  it('shows syntax errors as editor markers for the active file only', async () => {
    const r = rig();
    await r.controller.flush();
    r.ed.type('void loop() { digitalWrite(2, HIGH\n delay(5); }');
    await r.controller.flush();
    const markers = r.monaco.markers.get('/project/a.ino:codeblocks') as { severity: number; source: string; startLineNumber: number }[];
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]).toMatchObject({ severity: 8, source: 'Code Blocks' });
    r.ed.type('void loop() { delay(5); }');
    await r.controller.flush();
    expect(r.monaco.markers.get('/project/a.ino:codeblocks')).toEqual([]);
    r.binding.dispose();
  });

  it('moves the editor cursor → selects the block; highlights its lines', async () => {
    const r = rig();
    await r.controller.flush();
    r.ed.moveCursor(7);
    await new Promise((res) => setTimeout(res, 10));
    expect(r.get().selectedId).not.toBeNull();
    const last = r.ed.decos[r.ed.decos.length - 1] as { range: { startLineNumber: number }; options: { className: string; isWholeLine: boolean } }[];
    expect(last[0].range.startLineNumber).toBe(7);
    expect(last[0].options).toMatchObject({ isWholeLine: true, className: 'codeblocks-line-selected' });
    r.binding.dispose();
  });

  it('block click → scrolls the editor; blocks from another tab call openFile()', async () => {
    const other = { name: 'b.ino', content: 'void helper() {\n  delay(5);\n}\n' };
    const r = rig([other]);
    await r.controller.flush();
    const here = r.get().scene!.nodes.find((n) => n.src?.file === 'a.ino' && n.titleLines.join(' ') === 'Turn ON pin 13')!;
    r.controller.select(here.id, { reveal: true });
    expect(r.ed.revealed).toEqual([6]);
    const there = r.get().scene!.nodes.find((n) => n.src?.file === 'b.ino' && n.kind === 'wait')!;
    r.controller.select(there.id, { reveal: true });
    expect(r.opened).toEqual([['b.ino', 2]]);
    r.binding.dispose();
  });

  it('follows tab switches: clears old markers and tracks the new model', async () => {
    const r = rig([{ name: 'b.ino', content: 'void helper() {}\n' }]);
    await r.controller.flush();
    const b = fakeModel('/project/b.ino', 'void helper() { delay(9); }\n');
    r.ed.swapModel(b);
    expect(r.monaco.markers.get('/project/a.ino:codeblocks')).toEqual([]);
    r.ed.type('void helper() { delay(11); }\n');
    await r.controller.flush();
    expect(r.get().scene?.nodes.some((n) => n.titleLines.join(' ') === 'Wait 11 milliseconds')).toBe(true);
    r.binding.dispose();
  });

  it('dispose detaches everything and leaves no markers or decorations behind', async () => {
    const r = rig();
    await r.controller.flush();
    r.binding.dispose();
    expect(r.ed.handlers.content).toHaveLength(0);
    expect(r.ed.handlers.model).toHaveLength(0);
    expect(r.ed.handlers.cursor).toHaveLength(0);
    expect(r.ed.cleared).toBe(1);
    expect(r.monaco.markers.get('/project/a.ino:codeblocks')).toEqual([]);
    r.controller.select('x', { reveal: true });
    expect(r.ed.revealed).toEqual([]);
  });
});
