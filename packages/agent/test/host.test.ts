// A mock host: fake Monaco editor + a scripted "agent" calling the tools, both wired to one real handle.
// This is the shape of the real integration, minus the real Monaco and the real model.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCodeBlocks } from '@codeblocks/runtime';
import type { Analyzer, CodeBlocks } from '@codeblocks/runtime';
import type { EditorLike, ModelLike, MonacoLike } from '@codeblocks/runtime/monaco';
import { createNodeAnalyzer } from '@codeblocks/runtime/node';
import { createAgentTools } from '../src/index.ts';

const SRC = 'const int led = 13;\nvoid setup() {\n  pinMode(led, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(led, HIGH);\n  delay(500);\n  digitalWrite(led, LOW);\n  delay(500);\n}\n';

let analyzer: Analyzer;
beforeAll(() => { analyzer = createNodeAnalyzer(); });
const open: CodeBlocks[] = [];
afterEach(() => { for (const h of open.splice(0)) h.dispose(); });

function fakeHost() {
  const model: ModelLike & { value: string } = { uri: { path: '/ws/main.ino' }, value: SRC, getValue() { return this.value; }, getLineMaxColumn: () => 80 };
  const content: (() => void)[] = [];
  const cursor: ((e: { position: { lineNumber: number } }) => void)[] = [];
  const revealed: number[] = [];
  let decorations: unknown[] = [];
  const editor: EditorLike = {
    getModel: () => model,
    onDidChangeModelContent: (cb) => { content.push(cb); return { dispose: () => {} }; },
    onDidChangeModel: () => ({ dispose: () => {} }),
    onDidChangeCursorPosition: (cb) => { cursor.push(cb); return { dispose: () => {} }; },
    revealLineInCenterIfOutsideViewport: (l) => { revealed.push(l); },
    createDecorationsCollection: () => ({ set: (d) => { decorations = d; }, clear: () => { decorations = []; } }),
  };
  const monaco: MonacoLike = { editor: { setModelMarkers: () => {} }, MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 } };
  return {
    editor, monaco, model, revealed,
    get decorations() { return decorations; },
    type: (text: string) => { model.value = text; content.forEach((l) => l()); },
    moveCursor: (lineNumber: number) => cursor.forEach((l) => l({ position: { lineNumber } })),
  };
}

async function setup() {
  const blocks = createCodeBlocks({ analyzer, controller: { debounceMs: 0 }, validate: true, onWarn: (m) => { throw new Error(m); } });
  open.push(blocks);
  const host = fakeHost();
  blocks.attachMonaco({ editor: host.editor, monaco: host.monaco, cursorDebounceMs: 0 });
  await blocks.flush();
  return { blocks, host, agent: createAgentTools(blocks) };
}

describe('mock host: editor + blocks + agent on one handle', () => {
  it('the agent navigates: select by file+line reveals the line in the editor and highlights it', async () => {
    const { host, agent } = await setup();
    const r = await agent.call('blocks_select', { file: 'main.ino', line: 6 });
    expect(r.ok).toBe(true);
    expect(host.revealed.at(-1)).toBe(6);
    expect(host.decorations.length).toBeGreaterThan(0);
  });

  it('the agent sees what the user is looking at (cursor in the editor → get_selection)', async () => {
    const { host, agent } = await setup();
    host.moveCursor(7);
    await new Promise((r) => setTimeout(r, 20));
    const r = await agent.call('blocks_get_selection');
    expect(r.ok).toBe(true);
    const sel = (r as { result: { selected: { src?: { start: number } } | null } }).result.selected;
    expect(sel).not.toBeNull();
  });

  it('the agent sees edits the user just typed (settles before answering)', async () => {
    const { host, agent } = await setup();
    host.type(SRC.replace('delay(500);\n  digitalWrite(led, LOW)', 'delay(9999);\n  digitalWrite(led, LOW)'));
    const r = await agent.call('blocks_find', { query: '9999' });
    expect(r.ok).toBe(true);
    expect(JSON.stringify((r as { result: unknown }).result)).toContain('9999');
    expect(r.view.stale).toBe(false);
  });

  it('a syntax error in the editor reaches the agent as a problem, not a crash', async () => {
    const { host, agent } = await setup();
    host.type('void loop( { digitalWrite(13, HIGH) delay( }');
    const r = await agent.call('blocks_overview');
    expect(r.ok).toBe(true);
    expect((r as { result: { problems: unknown[] } }).result.problems.length).toBeGreaterThan(0);
  });

  it('disposing the handle makes the tools answer safely instead of throwing', async () => {
    const { blocks, agent } = await setup();
    blocks.dispose();
    const r = await agent.call('blocks_overview');
    expect(typeof r.ok).toBe('boolean');
  });
});
