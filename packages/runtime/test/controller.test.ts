import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlocksController, findNodeAt } from '../src/index.ts';
import { blocksAdapter, createBlocksStore } from '../src/zustand.ts';
import type { Analyzer } from '../src/index.ts';
import { createNodeAnalyzer } from '../src/node.ts';
import { AnalyzeError } from '@codeblocks/core';

const BLINK = 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000);\n  digitalWrite(13, LOW);\n  delay(1000);\n}\n';

let analyzer: Analyzer;
beforeAll(() => { analyzer = createNodeAnalyzer(); });

function setup(extra: Partial<ConstructorParameters<typeof BlocksController>[0]> = {}) {
  const store = createBlocksStore();
  const state = blocksAdapter(store);
  const controller = new BlocksController({ analyzer, state, debounceMs: 20, validate: true, onWarn: (m) => { throw new Error(m); }, ...extra });
  return { store, state, controller, get: () => store.getState().blocks };
}

describe('analysis scheduling', () => {
  it('debounces edits and publishes the latest result only', async () => {
    const spy = vi.spyOn(analyzer, 'analyze');
    const { controller, get } = setup();
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    spy.mockClear();
    for (const c of ['void loop(){}', 'void loop(){ delay(1); }', 'void loop(){ delay(2); }']) controller.updateFile('a.ino', c);
    expect(get().status).toBe('analyzing');
    expect(get().stale).toBe(true);
    await controller.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(get().status).toBe('ready');
    expect(get().scene?.nodes.some((n) => n.titleLines.join(' ') === 'Wait 2 milliseconds')).toBe(true);
    spy.mockRestore();
  });

  it('ignores an old result that finishes after a newer request started', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowFirst: Analyzer = {
      async analyze(req) {
        if (req.files[0].content === 'OLD') await gate;
        return analyzer.analyze(req);
      },
      warmUp: async () => {},
      dispose: () => {},
    };
    const { controller, get } = setup({ analyzer: slowFirst, debounceMs: 0 });
    controller.setFiles([{ name: 'a.ino', content: 'OLD' }]);
    await new Promise((r) => setTimeout(r, 5));
    controller.updateFile('a.ino', 'void loop(){ delay(7); }');
    await controller.flush();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(get().scene?.nodes.some((n) => n.titleLines.join(' ') === 'Wait 7 milliseconds')).toBe(true);
  });

  it('keeps the last good scene (marked stale) when an analysis fails', async () => {
    const failing: Analyzer = { analyze: async () => { throw new AnalyzeError('too-large', 'too big'); }, warmUp: async () => {}, dispose: () => {} };
    const { controller, get, store } = setup({ debounceMs: 0 });
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    const good = get().scene;
    expect(good).not.toBeNull();
    // swap in a failing analyzer for the next run
    const c2 = new BlocksController({ analyzer: failing, state: blocksAdapter(store), debounceMs: 0 });
    c2.setFiles([{ name: 'a.ino', content: 'x' }]);
    await c2.flush();
    expect(get().status).toBe('error');
    expect(get().error).toEqual({ code: 'too-large', message: 'too big' });
    expect(get().scene).toBe(good);
    expect(get().stale).toBe(true);
  });

  it('re-runs immediately when mode, code visibility or metrics change', async () => {
    const { controller, get } = setup();
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    expect(get().scene?.mode).toBe('kids');
    controller.setOptions({ mode: 'code' });
    await controller.flush();
    expect(get().scene?.mode).toBe('code');
    controller.setOptions({ showCode: false });
    await controller.flush();
    expect(get().scene?.nodes.every((n) => n.code === null)).toBe(true);
  });
});

describe('selection', () => {
  it('survives edits that do not touch the selected block (ids are regenerated, source position is not)', async () => {
    const { controller, get } = setup();
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    controller.selectByLocation('a.ino', 7); // delay(1000)
    const before = get().scene!.nodes.find((n) => n.id === get().selectedId)!;
    expect(before.titleLines.join(' ')).toBe('Wait 1 second');
    controller.updateFile('a.ino', BLINK.replace('pinMode(13, OUTPUT);', 'pinMode(13, OUTPUT);\n  Serial.begin(9600);'));
    await controller.flush();
    // the delay moved down one line; the old position (line 7) is now digitalWrite — selection follows the *position*
    expect(get().selectedId).not.toBeNull();
    const after = get().scene!.nodes.find((n) => n.id === get().selectedId)!;
    expect(after.src?.file).toBe('a.ino');
  });

  it('clears the selection when its block disappears', async () => {
    const { controller, get } = setup();
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    controller.selectByLocation('a.ino', 7);
    controller.updateFile('a.ino', 'void loop(){}');
    await controller.flush();
    expect(get().selectedId).toBeNull();
  });

  it('block → editor emits a reveal; editor → block does not echo one', async () => {
    const { controller, get } = setup();
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    const seen: unknown[] = [];
    controller.onReveal((loc, origin) => seen.push([loc, origin]));
    const node = get().scene!.nodes.find((n) => n.titleLines.join(' ') === 'Turn ON pin 13')!;
    controller.select(node.id, { reveal: true });
    expect(seen).toEqual([[{ file: 'a.ino', start: 6, end: 6 }, 'block']]);
    seen.length = 0;
    controller.selectByLocation('a.ino', 8);
    expect(seen).toEqual([]);
    expect(get().selectedId).not.toBe(node.id);
  });

  it('findNodeAt picks the smallest enclosing block', async () => {
    const { controller, get } = setup();
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    expect(findNodeAt(get().scene!, 'a.ino', 6)?.titleLines.join(' ')).toBe('Turn ON pin 13');
    expect(findNodeAt(get().scene!, 'nope.ino', 6)).toBeNull();
  });
});

describe('guided run', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('walks the blocks, reveals their lines, and stops itself', async () => {
    vi.useRealTimers();
    const { controller, get } = setup({ tourIntervalMs: 5, debounceMs: 0 });
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    const revealed: number[] = [];
    controller.onReveal((l, origin) => { if (origin === 'tour') revealed.push(l.start); });
    controller.play();
    expect(get().playing).toBe(true);
    expect(get().runningId).not.toBeNull();
    await new Promise((r) => setTimeout(r, 400));
    expect(get().playing).toBe(false);
    expect(get().runningId).toBeNull();
    expect(revealed.length).toBeGreaterThan(3);
    expect(revealed).toContain(6);
  });

  it('stops when the code changes underneath it', async () => {
    vi.useRealTimers();
    const { controller, get } = setup({ tourIntervalMs: 1000, debounceMs: 0 });
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    controller.play();
    expect(get().playing).toBe(true);
    controller.updateFile('a.ino', 'void loop(){}');
    await controller.flush();
    expect(get().playing).toBe(false);
  });

  it('does not let the editor cursor hijack the selection while playing', async () => {
    vi.useRealTimers();
    const { controller, get } = setup({ tourIntervalMs: 1000, debounceMs: 0 });
    controller.setFiles([{ name: 'a.ino', content: BLINK }]);
    await controller.flush();
    controller.play();
    const running = get().selectedId;
    controller.selectByLocation('a.ino', 9);
    expect(get().selectedId).toBe(running);
    controller.stopTour();
  });
});
