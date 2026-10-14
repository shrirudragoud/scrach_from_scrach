import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerAnalyzer } from '../src/analyzer.ts';
import type { WorkerLike } from '../src/analyzer.ts';
import type { WorkerRequest, WorkerResponse } from '../src/protocol.ts';
import type { Scene } from '@codeblocks/core';

const emptyScene = { version: 3, mode: 'kids', language: 'arduino', lanes: [], nodes: [], edges: [], regions: [], links: [], bounds: { w: 0, h: 0 } } as Scene;
const result = (tag: string) => ({ scene: { ...emptyScene, language: tag }, diagnostics: [], stats: { ms: 1, nodes: 0, edges: 0, functions: 0, files: 1 } });

/** A scriptable fake worker: replies are released manually so tests control ordering. */
class FakeWorker implements WorkerLike {
  static instances: FakeWorker[] = [];
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  terminated = false;
  received: WorkerRequest[] = [];
  autoInit = true;
  initError: { code: 'parser-unavailable'; message: string } | null = null;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(msg: WorkerRequest): void {
    this.received.push(msg);
    if (msg.type === 'init' && this.autoInit) {
      queueMicrotask(() => this.reply(this.initError ? { id: msg.id, ok: false, error: this.initError } : { id: msg.id, ok: true, type: 'ready' }));
    }
  }
  terminate(): void { this.terminated = true; }
  reply(r: WorkerResponse): void { this.onmessage?.({ data: r }); }
  analyses(): Extract<WorkerRequest, { type: 'analyze' }>[] { return this.received.filter((m): m is Extract<WorkerRequest, { type: 'analyze' }> => m.type === 'analyze'); }
}

const make = (extra = {}) => new WorkerAnalyzer({ assetBase: '/x/', workerFactory: () => new FakeWorker(), timeoutMs: 1000, ...extra });
const files = (c: string) => ({ files: [{ name: 'a.ino', content: c }] });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { FakeWorker.instances = []; });
afterEach(() => { vi.useRealTimers(); });

describe('WorkerAnalyzer', () => {
  it('loads the parser once, then analyses', async () => {
    const a = make();
    const p = a.analyze(files('1'));
    await tick();
    const w = FakeWorker.instances[0];
    expect(w.received[0]).toMatchObject({ type: 'init' });
    expect((w.received[0] as { grammars: Record<string, string> }).grammars.cpp).toContain('/x/tree-sitter-cpp.wasm');
    w.reply({ id: w.analyses()[0].id, ok: true, type: 'result', result: result('one') });
    expect((await p)?.scene.language).toBe('one');
    expect(w.received.filter((m) => m.type === 'init')).toHaveLength(1);
  });

  it('coalesces bursts: while one request runs only the newest follow-up is sent', async () => {
    const a = make();
    const p1 = a.analyze(files('1'));
    await tick();
    const w = FakeWorker.instances[0];
    const p2 = a.analyze(files('2'));
    const p3 = a.analyze(files('3'));
    expect(await p2).toBeNull(); // superseded by p3 before it ever reached the worker
    w.reply({ id: w.analyses()[0].id, ok: true, type: 'result', result: result('one') });
    await p1;
    await tick();
    expect(w.analyses()).toHaveLength(2);
    expect(w.analyses()[1].files[0].content).toBe('3');
    w.reply({ id: w.analyses()[1].id, ok: true, type: 'result', result: result('three') });
    expect((await p3)?.scene.language).toBe('three');
  });

  it('turns worker errors into typed AnalyzeErrors', async () => {
    const a = make();
    const p = a.analyze(files('x'));
    await tick();
    const w = FakeWorker.instances[0];
    w.reply({ id: w.analyses()[0].id, ok: false, error: { code: 'too-large', message: 'big' } });
    await expect(p).rejects.toMatchObject({ code: 'too-large', message: 'big' });
  });

  it('terminates a hung worker on timeout and recovers with a fresh one', async () => {
    vi.useFakeTimers();
    const a = make({ timeoutMs: 500 });
    const p = a.analyze(files('hang'));
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(501);
    await expect(p).rejects.toMatchObject({ code: 'internal' });
    expect(first.terminated).toBe(true);

    const p2 = a.analyze(files('again'));
    await vi.advanceTimersByTimeAsync(0);
    const second = FakeWorker.instances[1];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    second.reply({ id: second.analyses()[0].id, ok: true, type: 'result', result: result('recovered') });
    expect((await p2)?.scene.language).toBe('recovered');
  });

  it('reports a clear error when the parser files cannot be loaded, and retries later', async () => {
    const a = make({ workerFactory: () => { const w = new FakeWorker(); w.initError = { code: 'parser-unavailable', message: '404' }; return w; } });
    await expect(a.analyze(files('1'))).rejects.toMatchObject({ code: 'parser-unavailable', message: expect.stringContaining('404') });

    FakeWorker.instances[0].initError = null; // the asset is deployed now
    const p = a.analyze(files('2'));
    await tick();
    await tick();
    const w = FakeWorker.instances[0];
    w.reply({ id: w.analyses()[0].id, ok: true, type: 'result', result: result('ok') });
    expect((await p)?.scene.language).toBe('ok');
  });

  it('ignores late replies from requests that were abandoned', async () => {
    const a = make();
    a.warmUp().catch(() => undefined);
    await tick();
    const w = FakeWorker.instances[0];
    expect(() => w.reply({ id: 9999, ok: true, type: 'ready' })).not.toThrow();
  });

  it('dispose rejects new work and supersedes pending work', async () => {
    const a = make();
    const p = a.analyze(files('1'));
    await tick();
    a.dispose();
    await expect(p).rejects.toBeDefined();
    await expect(a.analyze(files('2'))).rejects.toMatchObject({ code: 'internal' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});
