import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCodeBlocks } from '@codeblocks/runtime';
import type { CodeBlocks } from '@codeblocks/runtime';
import { createNodeAnalyzer } from '@codeblocks/runtime/node';
import { createAgentTools, summarize, summaryToText } from '../src/index.ts';
import type { AgentToolkit } from '../src/index.ts';

const SKETCH = `#define TRIG 7
const int ledRed = 10;
void alarm(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(ledRed, HIGH);
    delay(100);
  }
}
void setup() {
  pinMode(ledRed, OUTPUT);
}
void loop() {
  int d = analogRead(A0);
  if (d < 30) {
    alarm(3);
  } else {
    digitalWrite(ledRed, LOW);
  }
  delay(100);
}
`;

let analyzer: ReturnType<typeof createNodeAnalyzer>;
beforeAll(() => { analyzer = createNodeAnalyzer(); });

let blocks: CodeBlocks | null = null;
afterEach(() => { blocks?.dispose(); blocks = null; });

async function open(code = SKETCH): Promise<{ blocks: CodeBlocks; kit: AgentToolkit }> {
  blocks = createCodeBlocks({ analyzer, controller: { debounceMs: 0 }, validate: true });
  blocks.setFiles([{ name: 'sketch.ino', content: code }], 'sketch.ino');
  await blocks.flush();
  return { blocks, kit: createAgentTools(blocks) };
}

const ok = async (kit: AgentToolkit, name: string, args?: unknown): Promise<any> => {
  const r = await kit.call(name, args);
  if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
  return r.result;
};

describe('agent tools on a real analysis', () => {
  it('overview lists the functions with their relationships', async () => {
    const { blocks: b, kit } = await open();
    const o = await ok(kit, 'blocks_overview');
    const byName = Object.fromEntries(o.functions.map((f: any) => [f.name, f]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['setup', 'loop', 'alarm']));
    expect(byName.loop.calls).toContain('alarm');
    expect(byName.alarm.calledBy).toContain('loop');
    expect(byName.loop.where.file).toBe('sketch.ino');
    expect(o.problems).toEqual([]);
    expect(summaryToText(summarize(b.getState().scene!))).toContain('alarm');
  });

  it('get_function returns steps in execution order with branch labels', async () => {
    const { kit } = await open();
    const f = await ok(kit, 'blocks_get_function', { name: 'loop' });
    expect(f.steps[0].kind).toBe('start');
    const decision = f.steps.find((s: any) => s.kind === 'decision');
    expect(decision.next.map((n: any) => n.label).sort()).toEqual(['no', 'yes']);
    expect(f.truncated).toBe(false);
  });

  it('get_block works by id and by file+line, and describes neighbours', async () => {
    const { kit } = await open();
    const f = await ok(kit, 'blocks_get_function', { name: 'loop' });
    const decision = f.steps.find((s: any) => s.kind === 'decision');
    const byId = await ok(kit, 'blocks_get_block', { id: decision.id });
    const byLine = await ok(kit, 'blocks_get_block', { file: 'sketch.ino', line: decision.where.line });
    expect(byLine.id).toBe(byId.id);
    expect(byId.function).toBe('loop');
    expect(byId.next).toHaveLength(2);
    expect(byId.previous.length).toBeGreaterThan(0);
    expect(byId.explain.length).toBeGreaterThan(0);
  });

  it('find searches titles and code', async () => {
    const { kit } = await open();
    expect((await ok(kit, 'blocks_find', { query: 'alarm' })).total).toBeGreaterThan(0);
    expect(await ok(kit, 'blocks_find', { query: 'zzz-nothing' })).toEqual({ matches: [], total: 0 });
    const loops = await ok(kit, 'blocks_find', { query: '', kind: 'loop' });
    expect(loops.matches.length).toBeGreaterThan(0);
    expect(loops.matches.every((m: any) => m.kind === 'loop')).toBe(true);
  });

  it('select navigates: updates the selection and asks the editor to reveal the lines', async () => {
    const { blocks: b, kit } = await open();
    const reveals: unknown[] = [];
    b.onReveal((loc, origin) => reveals.push([loc.file, loc.start, origin]));
    const r = await ok(kit, 'blocks_select', { file: 'sketch.ino', line: 14 });
    expect(b.getState().selectedId).toBe(r.selected.id);
    expect(reveals).toEqual([['sketch.ino', 14, 'block']]);
    expect((await ok(kit, 'blocks_get_selection')).selected.id).toBe(r.selected.id);

    reveals.length = 0;
    await ok(kit, 'blocks_select', { file: 'sketch.ino', line: 5, reveal: false });
    expect(reveals).toEqual([]);

    await ok(kit, 'blocks_select', { clear: true });
    expect(b.getState().selectedId).toBeNull();
  });

  it('a selection made by the user (cursor) is visible to the agent', async () => {
    const { blocks: b, kit } = await open();
    b.selectByLocation('sketch.ino', 6);
    expect((await ok(kit, 'blocks_get_selection')).selected.where.line).toBe(6);
  });

  it('run_order mirrors the guided walkthrough', async () => {
    const { kit } = await open();
    const r = await ok(kit, 'blocks_run_order', { max_steps: 10 });
    expect(r.steps).toHaveLength(10);
    expect(r.steps[0].step).toBe(1);
  });

  it('waits for a pending analysis, so the agent sees the latest edit', async () => {
    const { blocks: b, kit } = await open();
    b.updateFile('sketch.ino', 'void loop() { delay(42); }');
    expect(b.getState().status).toBe('analyzing');
    const r = await kit.call('blocks_find', { query: '42 milliseconds' });
    expect(r.ok && (r.result as any).total).toBeGreaterThan(0);
    expect(r.view.status).toBe('ready');
  });
});

describe('failure behaviour', () => {
  it('reports unknown tools, bad arguments and stale ids without throwing', async () => {
    const { kit } = await open();
    expect((await kit.call('nope')).ok).toBe(false);
    const bad = await kit.call('blocks_get_function', {});
    expect(!bad.ok && bad.error.code).toBe('bad-arguments');
    const bad2 = await kit.call('blocks_get_block', { file: 7, line: 3 });
    expect(!bad2.ok && bad2.error.code).toBe('bad-arguments');
    const none = await kit.call('blocks_get_block', { id: 'n99999' });
    expect(!none.ok && none.error.code).toBe('not-found');
    expect(!none.ok && none.error.message).toMatch(/ids change/);
    const nofn = await kit.call('blocks_get_function', { name: 'ghost' });
    expect(!nofn.ok && nofn.error.code).toBe('not-found');
    const notObj = await kit.call('blocks_overview', [1]);
    expect(!notObj.ok && notObj.error.code).toBe('bad-arguments');
    const nowhere = await kit.call('blocks_select', { file: 'sketch.ino', line: 999 });
    expect(!nowhere.ok && nowhere.error.code).toBe('not-found');
  });

  it('says there are no blocks before the first analysis, but overview still answers', async () => {
    blocks = createCodeBlocks({ analyzer, controller: { debounceMs: 0 } });
    const kit = createAgentTools(blocks);
    const r = await kit.call('blocks_get_function', { name: 'loop' });
    expect(!r.ok && r.error.code).toBe('no-blocks');
    expect((await kit.call('blocks_overview')).ok).toBe(true);
  });

  it('reports syntax problems in the overview', async () => {
    const { blocks: b, kit } = await open();
    b.updateFile('sketch.ino', 'void loop() { digitalWrite(2, HIGH\n delay(5); }');
    await b.flush();
    const o = await ok(kit, 'blocks_overview');
    expect(o.problems.length).toBeGreaterThan(0);
    expect(o.problems[0]).toMatchObject({ file: 'sketch.ino' });
  });

  it('honours prefix and exposes JSON-Schema inputs for every tool', async () => {
    const { blocks: b } = await open();
    const kit = createAgentTools(b, { prefix: 'cb.' });
    expect(kit.tools.every((t) => t.name.startsWith('cb.') && (t.inputSchema as any).type === 'object' && t.description.length > 20)).toBe(true);
    expect(new Set(kit.tools.map((t) => t.name)).size).toBe(kit.tools.length);
    expect((await kit.call('cb.overview')).ok).toBe(true);
  });
});
