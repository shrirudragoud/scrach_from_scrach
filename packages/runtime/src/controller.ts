// BlocksController — the framework-agnostic brain of the block view.
//
//   files in ──► debounce ──► analyzer ──► latest-wins ──► state (scene, diagnostics, status)
//   selection / playback ◄──► state ◄──► editor binding (reveal events, cursor → block)
//
// It owns scheduling, staleness, selection that survives edits, and the guided run. It has no DOM and
// no React/Monaco/Zustand imports.

import { buildTour, findNodeAt, AnalyzeError } from '@codeblocks/core';
import type { ProjectFile, Scene, SceneMode, SourceLoc, TextMetrics } from '@codeblocks/core';
import { validateScene } from '@codeblocks/core/validate';
import type { Analyzer } from './analyzer.ts';
import type { StateAdapter } from './store.ts';

export interface ControllerOptions {
  analyzer: Analyzer;
  state: StateAdapter;
  language?: string;
  main?: string;
  debounceMs?: number;
  /** Milliseconds each block is highlighted during ▶ Watch it run. */
  tourIntervalMs?: number;
  /** Run structural validation on every scene and report violations (enable in development). */
  validate?: boolean;
  onWarn?: (message: string, detail?: unknown) => void;
  /** Called whenever an analysis fails (the last good scene stays on screen, marked stale). */
  onError?: (error: { code: string; message: string }) => void;
}

export type RevealListener = (loc: SourceLoc, origin: 'block' | 'tour') => void;

export class BlocksController {
  private readonly o: Required<Pick<ControllerOptions, 'debounceMs' | 'tourIntervalMs'>> & ControllerOptions;
  private files = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private tourTimer: ReturnType<typeof setTimeout> | null = null;
  private revealListeners = new Set<RevealListener>();
  private disposed = false;
  private inflight: Promise<void> = Promise.resolve();

  constructor(options: ControllerOptions) {
    this.o = { debounceMs: 250, tourIntervalMs: 1300, ...options };
  }

  // ---- project input ------------------------------------------------------------------------

  /** Replace the whole project (open a sketch, switch project). Analysis starts immediately. */
  setFiles(files: ProjectFile[], main?: string): void {
    this.files = new Map(files.map((f) => [f.name, f.content]));
    if (main) this.o.main = main;
    this.stopTour();
    this.schedule(true);
  }

  /** Live edit of one file (called on every keystroke by the editor binding). */
  updateFile(name: string, content: string): void {
    if (this.files.get(name) === content) return;
    this.files.set(name, content);
    this.schedule(false);
  }

  removeFile(name: string): void {
    if (this.files.delete(name)) this.schedule(false);
  }

  setMain(name: string): void {
    this.o.main = name;
    this.schedule(true);
  }

  setOptions(p: { mode?: SceneMode; showCode?: boolean; metrics?: Partial<TextMetrics> }): void {
    const cur = this.o.state.get();
    const next = { mode: p.mode ?? cur.mode, showCode: p.showCode ?? cur.showCode, metrics: p.metrics ?? cur.metrics };
    if (next.mode === cur.mode && next.showCode === cur.showCode && sameMetrics(next.metrics, cur.metrics)) return;
    this.o.state.patch(next);
    this.stopTour();
    this.schedule(true);
  }

  // ---- analysis -----------------------------------------------------------------------------

  private schedule(immediate: boolean): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    const s = this.o.state.get();
    const stale = s.scene !== null;
    if (s.status !== 'analyzing' || s.stale !== stale) this.o.state.patch({ status: 'analyzing', stale });
    this.timer = setTimeout(() => { this.timer = null; this.inflight = this.run(); }, immediate ? 0 : this.o.debounceMs);
  }

  /** Resolves when the analysis currently scheduled/running has been applied (handy in tests). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; this.inflight = this.run(); }
    await this.inflight;
  }

  private async run(): Promise<void> {
    const mine = ++this.seq;
    const st = this.o.state.get();
    const files = [...this.files].map(([name, content]) => ({ name, content }));
    try {
      const res = await this.o.analyzer.analyze({
        files,
        options: { language: this.o.language, main: this.o.main, mode: st.mode, showCode: st.showCode, metrics: st.metrics },
      });
      if (this.disposed || mine !== this.seq || res === null) return;
      this.stopTour();
      const prev = this.o.state.get();
      const selectedId = this.rebindSelection(prev.scene, prev.selectedId, res.scene);
      this.o.state.patch({ status: 'ready', stale: false, scene: res.scene, diagnostics: res.diagnostics, stats: res.stats, error: null, selectedId, runningId: null, runningEdgeId: null });
      if (this.o.validate) {
        const v = validateScene(res.scene);
        if (v.length) this.o.onWarn?.(`Block layout violated ${v.length} invariant(s): ${v[0].message}`, v);
      }
    } catch (e) {
      if (this.disposed || mine !== this.seq) return;
      const err = e instanceof AnalyzeError ? e : new AnalyzeError('internal', e instanceof Error ? e.message : String(e));
      const prev = this.o.state.get();
      this.o.state.patch({ status: 'error', stale: prev.scene !== null, error: { code: err.code, message: err.message } });
      this.o.onError?.({ code: err.code, message: err.message });
    }
  }

  /** Node ids are regenerated on every analysis, so keep the selection by *where it is in the source*. */
  private rebindSelection(prev: Scene | null, prevId: string | null, next: Scene): string | null {
    if (!prev || !prevId) return null;
    const old = prev.nodes.find((n) => n.id === prevId);
    if (!old?.src) return null;
    return findNodeAt(next, old.src.file, old.src.start)?.id ?? null;
  }

  // ---- selection ----------------------------------------------------------------------------

  /** Select a block (null clears). With `reveal`, the editor is asked to show its source lines. */
  select(id: string | null, { reveal = false }: { reveal?: boolean } = {}): void {
    const st = this.o.state.get();
    if (st.selectedId !== id) this.o.state.patch({ selectedId: id });
    if (reveal && id && st.scene) {
      const n = st.scene.nodes.find((x) => x.id === id);
      if (n?.src) this.emitReveal(n.src, 'block');
    }
  }

  /** Editor cursor → block. Never echoes a reveal back to the editor. */
  selectByLocation(file: string, line: number): void {
    const st = this.o.state.get();
    if (!st.scene || st.playing) return;
    const n = findNodeAt(st.scene, file, line);
    if (n?.id !== st.selectedId) this.o.state.patch({ selectedId: n?.id ?? null });
  }

  onReveal(listener: RevealListener): () => void {
    this.revealListeners.add(listener);
    return () => this.revealListeners.delete(listener);
  }

  private emitReveal(loc: SourceLoc, origin: 'block' | 'tour'): void {
    for (const l of this.revealListeners) l(loc, origin);
  }

  // ---- guided run ---------------------------------------------------------------------------

  togglePlay(): void {
    if (this.o.state.get().playing) this.stopTour(); else this.play();
  }

  play(): void {
    const scene = this.o.state.get().scene;
    if (!scene || this.disposed) return;
    const steps = buildTour(scene);
    if (!steps.length) return;
    this.stopTour();
    this.o.state.patch({ playing: true });
    let i = 0;
    const tick = (): void => {
      if (i >= steps.length) { this.stopTour(); return; }
      const { node, via } = steps[i++];
      this.o.state.patch({ runningId: node.id, runningEdgeId: via?.id ?? null, selectedId: node.id });
      if (node.src) this.emitReveal(node.src, 'tour');
      this.tourTimer = setTimeout(tick, this.o.tourIntervalMs);
    };
    tick();
  }

  stopTour(): void {
    if (this.tourTimer) { clearTimeout(this.tourTimer); this.tourTimer = null; }
    const s = this.o.state.get();
    if (s.playing || s.runningId || s.runningEdgeId) this.o.state.patch({ playing: false, runningId: null, runningEdgeId: null });
  }

  // ---- lifecycle ----------------------------------------------------------------------------

  warmUp(): Promise<void> {
    return this.o.analyzer.warmUp().catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopTour();
    this.revealListeners.clear();
    this.o.analyzer.dispose();
  }
}

function sameMetrics(a: Partial<TextMetrics> | undefined, b: Partial<TextMetrics> | undefined): boolean {
  return a?.title === b?.title && a?.small === b?.small && a?.mono === b?.mono;
}
