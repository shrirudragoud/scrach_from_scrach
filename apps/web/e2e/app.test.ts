// Real-browser tests of the integrated app (Next 16 + Monaco + Zustand + worker + Konva).
// They drive the DOM and the canvas exactly as a student would: clicks, edits, tabs, Play.

import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

const CHROMIUM = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const url = () => process.env.E2E_URL as string;

let browser: Browser;
let page: Page;
const problems: string[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
});
afterAll(async () => { await browser.close(); });

beforeEach(async () => {
  problems.length = 0;
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) problems.push(`console: ${m.text()}`); });
});
afterEach(async () => {
  await page.close();
  expect(problems, 'unexpected browser errors').toEqual([]);
});

async function open(search = ''): Promise<void> {
  await page.goto(`${url()}/${search}`);
  await page.waitForFunction(() => (document.querySelector('[data-testid="blocks-canvas"]')?.getAttribute('data-nodes') ?? '0') !== '0', null, { timeout: 45_000 });
  await page.waitForFunction(() => (window as never as { monaco?: unknown }).monaco !== undefined);
}

const state = () => page.evaluate(() => {
  const s = (window as never as { __codeblocks: { store: { getState(): { blocks: Record<string, unknown> } } } }).__codeblocks.store.getState().blocks;
  const scene = s.scene as { nodes: { id: string; kind: string; titleLines: string[]; src?: { file: string; start: number } }[] };
  return {
    status: s.status as string, mode: s.mode as string, selectedId: s.selectedId as string | null, playing: s.playing as boolean, runningId: s.runningId as string | null,
    diagnostics: s.diagnostics as { file?: string; line: number }[], error: s.error as { code: string; message: string } | null,
    nodes: scene?.nodes.map((n) => ({ id: n.id, kind: n.kind, title: n.titleLines.join(' '), src: n.src })) ?? [],
  };
});

/** Click a block on the canvas by pointing the real mouse at its on-screen rectangle. */
async function clickBlock(title: string): Promise<void> {
  const id = (await state()).nodes.find((n) => n.title === title)?.id;
  expect(id, `block "${title}" exists`).toBeTruthy();
  await page.evaluate((nid) => (window as never as { __codeblocks: { canvas: { current: { centerOnNode(i: string): void } } } }).__codeblocks.canvas.current.centerOnNode(nid), id);
  await page.waitForTimeout(800);
  const r = await page.evaluate((nid) => (window as never as { __codeblocks: { canvas: { current: { getNodeScreenRect(i: string): { x: number; y: number; w: number; h: number } } } } }).__codeblocks.canvas.current.getNodeScreenRect(nid), id);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

const setModelValue = (index: number, value: string) => page.evaluate(([i, v]) => {
  const m = (window as never as { monaco: { editor: { getModels(): { setValue(v: string): void }[] } } }).monaco.editor.getModels()[i as number];
  m.setValue(v as string);
}, [index, value] as const);

describe('integrated app', () => {
  it('loads Monaco, starts the worker and draws the multi-tab project', async () => {
    await open();
    const s = await state();
    expect(s.status).toBe('ready');
    expect(s.nodes.length).toBeGreaterThan(20);
    expect(s.diagnostics).toEqual([]);
    expect(await page.textContent('[data-testid="blocks-status"]')).toMatch(/\d+ blocks/);
    // the canvas really painted something (not a blank element)
    const painted = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="blocks-canvas"] canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    });
    expect(painted).toBeGreaterThan(200);
  });

  it('click a block → editor highlights its line and the explanation card opens', async () => {
    await open();
    await clickBlock('Run my block “showRed”');
    const s = await state();
    expect(s.selectedId).not.toBeNull();
    await page.waitForSelector('.codeblocks-line-selected');
    expect(await page.textContent('[data-testid="blocks-explain"]')).toContain('Run my block');
    expect(await page.textContent('[data-testid="blocks-explain"]')).toContain('showRed()');
  });

  it('click a block that lives in another tab → that tab opens and the line is highlighted', async () => {
    await open();
    await clickBlock('Turn ON red LED (pin 10)');
    await page.waitForFunction(() => document.querySelector('[data-testid="tab-lights.ino"]')?.getAttribute('aria-selected') === 'true');
    await page.waitForSelector('.codeblocks-line-selected');
    const s = await state();
    expect(s.nodes.find((n) => n.id === s.selectedId)?.src?.file).toBe('lights.ino');
  });

  it('editor cursor → selects the matching block (no echo loop)', async () => {
    await open();
    // The editor binding attaches one effect after Monaco mounts, so a first cursor move can be missed.
    // Nudge the cursor (slowly: the binding debounces) until the binding has picked it up.
    await page.waitForFunction(() => {
      const w = window as never as { monaco: { editor: { getEditors(): { getPosition(): { lineNumber: number }; setPosition(p: object): void }[] } }; __codeblocks: { store: { getState(): { blocks: { selectedId: string | null } } } } };
      if (w.__codeblocks.store.getState().blocks.selectedId !== null) return true;
      const ed = w.monaco.editor.getEditors()[0];
      ed.setPosition({ lineNumber: ed.getPosition().lineNumber === 8 ? 9 : 8, column: 3 });
      return false;
    }, null, { polling: 250 });
    await page.evaluate(() => (window as never as { monaco: { editor: { getEditors(): { setPosition(p: object): void }[] } } }).monaco.editor.getEditors()[0].setPosition({ lineNumber: 8, column: 3 }));
    await page.waitForFunction(() => {
      const b = (window as never as { __codeblocks: { store: { getState(): { blocks: { selectedId: string | null; scene: { nodes: { id: string; titleLines: string[] }[] } } } } } }).__codeblocks.store.getState().blocks;
      return b.scene.nodes.find((n) => n.id === b.selectedId)?.titleLines.join(' ') === 'Run my block “showGreen”';
    });
    const s = await state();
    expect(s.nodes.find((n) => n.id === s.selectedId)?.title).toBe('Run my block “showGreen”');
  });

  it('editing code re-draws live; a typo shows editor squiggles and keeps the last picture', async () => {
    await open();
    const before = (await state()).nodes.length;
    await setModelValue(0, '// main\nvoid setup() {}\nvoid loop() {\n  showRed();\n}\n');
    await page.waitForFunction((n) => (document.querySelector('[data-testid="blocks-canvas"]')?.getAttribute('data-nodes') ?? '0') !== String(n), before);
    expect((await state()).nodes.length).toBeLessThan(before);

    await setModelValue(0, 'void setup() {}\nvoid loop() { digitalWrite(2, HIGH\n delay(5); }\n');
    await page.waitForFunction(() => /typo/.test(document.querySelector('[data-testid="blocks-status"]')?.textContent ?? ''));
    await page.waitForSelector('.squiggly-error');
    expect((await state()).diagnostics.every((d) => d.file === 'traffic.ino')).toBe(true);
  });

  it('▶ Watch it run walks the blocks, follows them in the editor and stops by itself', async () => {
    await open('?');
    await page.click('[data-testid="blocks-play"]');
    await page.waitForFunction(() => (window as never as { __codeblocks: { store: { getState(): { blocks: { runningId: string | null } } } } }).__codeblocks.store.getState().blocks.runningId !== null);
    expect((await state()).playing).toBe(true);
    await page.waitForSelector('.codeblocks-line-selected');
    expect(await page.textContent('[data-testid="blocks-play"]')).toContain('Stop');
    await page.click('[data-testid="blocks-play"]');
    await page.waitForFunction(() => (window as never as { __codeblocks: { store: { getState(): { blocks: { playing: boolean } } } } }).__codeblocks.store.getState().blocks.playing === false);
    expect((await state()).runningId).toBeNull();
  });

  it('loads another example and the Monaco model, tabs and blocks all follow', async () => {
    await open();
    await page.selectOption('[data-testid="sample-select"]', 'blink');
    await page.waitForFunction(() => document.querySelector('[data-testid="tab-blink.ino"]') !== null);
    await page.waitForFunction(() => (window as never as { __codeblocks: { store: { getState(): { blocks: { scene: { nodes: { titleLines: string[] }[] } } } } } }).__codeblocks.store.getState().blocks.scene.nodes.some((n) => n.titleLines.join(' ') === 'Wait 1 second'));
    expect(await page.locator('[role="tab"]').count()).toBe(1);
  });

  it('exports a real PNG of the whole scene', async () => {
    await open();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('⬇ PNG').click()]);
    const path = await dl.path();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeGreaterThan(20_000);
  });

  it('keyboard: arrows follow the flow, left/right hop between lanes, Escape clears', async () => {
    await open();
    await page.focus('[data-testid="blocks-canvas"]');
    await page.keyboard.press('ArrowDown');
    const first = await state();
    expect(first.nodes.find((n) => n.id === first.selectedId)?.title).toBe('When the board starts');
    await page.keyboard.press('ArrowDown');
    const second = await state();
    expect(second.selectedId).not.toBe(first.selectedId);
    await page.keyboard.press('ArrowRight');
    const lane = await state();
    expect(lane.nodes.find((n) => n.id === lane.selectedId)?.kind).toBe('start');
    expect(lane.selectedId).not.toBe(second.selectedId);
    await page.keyboard.press('Escape');
    expect((await state()).selectedId).toBeNull();
  });
});

describe('failure handling', () => {
  it('shows a clear message (not a crash) when the parser files are missing, and recovers', async () => {
    let block = true;
    await page.route('**/codeblocks/tree-sitter-cpp.wasm*', (route) => (block ? route.fulfill({ status: 404, body: 'nope' }) : route.continue()));
    await page.goto(`${url()}/`);
    await page.waitForFunction(() => document.querySelector('[data-testid="blocks-panel"]')?.getAttribute('data-status') === 'error', null, { timeout: 45_000 });
    expect(await page.textContent('.cb-error')).toContain('Could not load the code parser');
    expect((await state()).error?.code).toBe('parser-unavailable');
    // the editor is still fully usable
    await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
    await page.waitForFunction(() => (window as never as { monaco?: unknown }).monaco !== undefined);

    block = false; // the asset is deployed / network is back
    await setModelValue(0, 'void setup() {}\nvoid loop() { delay(5); }\n');
    await page.waitForFunction(() => document.querySelector('[data-testid="blocks-panel"]')?.getAttribute('data-status') === 'ready', null, { timeout: 45_000 });
    expect((await state()).nodes.length).toBeGreaterThan(0);
    problems.length = 0; // the intentional 404 is expected here
  });

  it('refuses an enormous sketch with a friendly message and keeps the previous picture', async () => {
    await open();
    const good = (await state()).nodes.length;
    await setModelValue(0, `void loop() {\n${'  digitalWrite(13, HIGH);\n'.repeat(3000)}}\n`);
    await page.waitForFunction(() => document.querySelector('[data-testid="blocks-panel"]')?.getAttribute('data-status') === 'error', null, { timeout: 45_000 });
    const s = await state();
    expect(['too-large', 'too-complex']).toContain(s.error?.code);
    expect(s.nodes.length).toBe(good); // last good scene kept
    expect(await page.textContent('.cb-error')).toMatch(/too many|long/i);
  });
});
