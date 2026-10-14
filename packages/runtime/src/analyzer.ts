// The analyzer client: runs analyses in a Web Worker with
//   • latest-wins coalescing — typing fast never queues work; superseded requests resolve to `null`
//   • a hard timeout — a stuck worker is terminated and transparently respawned on the next request
//   • typed failures    — everything surfaces as AnalyzeError (code + student-readable message)

import { AnalyzeError } from '@codeblocks/core';
import type { ProjectFile, ProjectOptions, WireResult } from '@codeblocks/core';
import type { WorkerRequest, WorkerRequestBody, WorkerResponse } from './protocol.ts';

export interface AnalyzeRequest {
  files: ProjectFile[];
  options?: ProjectOptions;
}

export interface Analyzer {
  /** Resolves to `null` when a newer request superseded this one. Rejects with AnalyzeError. */
  analyze(req: AnalyzeRequest): Promise<WireResult | null>;
  /** Start loading the parser in the background (call when the panel is likely to open). */
  warmUp(): Promise<void>;
  dispose(): void;
}

/** The part of the Worker API we use (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerResponse }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface WorkerAnalyzerOptions {
  /** Folder the assets were copied to (`codeblocks-assets public/codeblocks` → '/codeblocks/'). */
  assetBase?: string;
  /** Cache-buster, e.g. the contents of version.txt. */
  version?: string;
  workerUrl?: string;
  runtimeWasm?: string;
  grammars?: Record<string, string>;
  timeoutMs?: number;
  /** Test seam. Default: `new Worker(url)`. */
  workerFactory?: (url: string) => WorkerLike;
}

interface Pending {
  req: AnalyzeRequest;
  resolve: (r: WireResult | null) => void;
  reject: (e: Error) => void;
}

interface InFlight {
  id: number;
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const absolute = (p: string): string => (typeof location !== 'undefined' ? new URL(p, location.href).href : p);

export class WorkerAnalyzer implements Analyzer {
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private inflight: InFlight | null = null;
  private pending: Pending | null = null;
  private disposed = false;
  private readonly workerUrl: string;
  private readonly runtimeWasm: string;
  private readonly grammars: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly factory: (url: string) => WorkerLike;

  constructor(o: WorkerAnalyzerOptions = {}) {
    const base = (o.assetBase ?? '/codeblocks/').replace(/\/?$/, '/');
    const v = o.version ? `?v=${encodeURIComponent(o.version)}` : '';
    this.workerUrl = absolute(o.workerUrl ?? `${base}analyzer.worker.js${v}`);
    this.runtimeWasm = absolute(o.runtimeWasm ?? `${base}tree-sitter.wasm${v}`);
    this.grammars = Object.fromEntries(Object.entries(o.grammars ?? { cpp: `${base}tree-sitter-cpp.wasm${v}` }).map(([k, u]) => [k, absolute(u)]));
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.factory = o.workerFactory ?? ((url) => new Worker(url) as unknown as WorkerLike);
  }

  // ---- worker lifecycle ---------------------------------------------------------------------

  private spawn(): WorkerLike {
    const w = this.factory(this.workerUrl);
    w.onmessage = (ev) => this.onMessage(ev.data);
    w.onerror = () => this.fail(new AnalyzeError('parser-unavailable', 'The block view could not start its background worker.'));
    this.worker = w;
    return w;
  }

  private onMessage(msg: WorkerResponse): void {
    const f = this.inflight;
    if (!f || f.id !== msg.id) return; // late answer from a request we already gave up on
    clearTimeout(f.timer);
    this.inflight = null;
    f.resolve(msg);
  }

  /** Kill the worker and fail whatever was running; the next request starts a fresh one. */
  private fail(err: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    const f = this.inflight;
    this.inflight = null;
    if (f) { clearTimeout(f.timer); f.reject(err); }
  }

  private send(msg: WorkerRequestBody): Promise<WorkerResponse> {
    const worker = this.worker ?? this.spawn();
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new AnalyzeError('internal', 'Analysis took too long and was stopped.')), this.timeoutMs);
      this.inflight = { id, resolve, reject, timer };
      worker.postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.send({ type: 'init', runtimeWasm: this.runtimeWasm, grammars: this.grammars }).then((r) => {
      if (!r.ok) {
        this.ready = null;
        throw new AnalyzeError(r.error.code === 'internal' ? 'parser-unavailable' : r.error.code, `Could not load the code parser (${r.error.message}).`);
      }
    }, (e) => { this.ready = null; throw e; });
    return this.ready;
  }

  warmUp(): Promise<void> {
    return this.ensureReady();
  }

  // ---- requests -----------------------------------------------------------------------------

  analyze(req: AnalyzeRequest): Promise<WireResult | null> {
    if (this.disposed) return Promise.reject(new AnalyzeError('internal', 'Analyzer was disposed.'));
    return new Promise<WireResult | null>((resolve, reject) => {
      this.pending?.resolve(null); // superseded
      this.pending = { req, resolve, reject };
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending && !this.disposed) {
        const job = this.pending;
        this.pending = null;
        try {
          await this.ensureReady();
          const res = await this.send({ type: 'analyze', files: job.req.files, options: job.req.options ?? {} });
          if (res.ok && res.type === 'result') job.resolve(res.result);
          else if (!res.ok) job.reject(new AnalyzeError(res.error.code, res.error.message));
          else job.reject(new AnalyzeError('internal', 'Unexpected worker reply.'));
        } catch (e) {
          job.reject(e instanceof Error ? e : new AnalyzeError('internal', String(e)));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private running = false;

  dispose(): void {
    this.disposed = true;
    this.pending?.resolve(null);
    this.pending = null;
    this.fail(new AnalyzeError('internal', 'Analyzer was disposed.'));
  }
}

export function createWorkerAnalyzer(options?: WorkerAnalyzerOptions): Analyzer {
  return new WorkerAnalyzer(options);
}
