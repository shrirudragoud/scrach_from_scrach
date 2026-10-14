// Monaco binding. Uses minimal structural types instead of importing monaco-editor, so it works with
// any Monaco version (and with @monaco-editor/react's instance) without a second copy of the editor.
//
//   const binding = attachMonaco({ controller, state, editor, monaco, openFile: (f, line) => tabs.open(f, line) });
//   …
//   binding.dispose();
//
// What it does:
//   editor ─► controller   every edit of the active model → updateFile(); cursor → selectByLocation()
//   controller ─► editor   diagnostics → markers (squiggles); selected / running block → line highlight;
//                          reveal events → scroll (or openFile() when the block lives in another tab)

import type { Diagnostic, SourceLoc } from '@codeblocks/core';
import type { BlocksController } from './controller.ts';
import type { StateAdapter } from './store.ts';

interface Disposable { dispose(): void }

export interface ModelLike {
  uri: { path: string };
  getValue(): string;
  getLineMaxColumn(line: number): number;
}

export interface DecorationsCollectionLike {
  set(decorations: unknown[]): void;
  clear(): void;
}

export interface EditorLike {
  getModel(): ModelLike | null;
  onDidChangeModelContent(cb: () => void): Disposable;
  onDidChangeModel(cb: () => void): Disposable;
  onDidChangeCursorPosition(cb: (e: { position: { lineNumber: number } }) => void): Disposable;
  revealLineInCenterIfOutsideViewport(line: number): void;
  createDecorationsCollection(decorations?: unknown[]): DecorationsCollectionLike;
}

export interface MonacoLike {
  editor: { setModelMarkers(model: ModelLike, owner: string, markers: unknown[]): void };
  MarkerSeverity: { Error: number; Warning: number; Info: number; Hint: number };
}

export interface AttachMonacoOptions {
  controller: BlocksController;
  state: StateAdapter;
  editor: EditorLike;
  monaco: MonacoLike;
  /** Map a Monaco model to the project file name. Default: last segment of the model URI. */
  fileOf?: (model: ModelLike) => string;
  /** Called when a block lives in a file other than the one currently shown. */
  openFile?: (file: string, line: number) => void;
  markerOwner?: string;
  cursorDebounceMs?: number;
  classNames?: { selected?: string; running?: string };
}

export interface MonacoBinding {
  dispose(): void;
  /** Re-read the active model (call after your IDE swaps models without Monaco events). */
  sync(): void;
}

export function attachMonaco(opts: AttachMonacoOptions): MonacoBinding {
  const { controller, state, editor, monaco } = opts;
  const owner = opts.markerOwner ?? 'codeblocks';
  const cls = { selected: 'codeblocks-line-selected', running: 'codeblocks-line-running', ...opts.classNames };
  const fileOf = opts.fileOf ?? ((m: ModelLike) => m.uri.path.split('/').pop() ?? m.uri.path);
  const decorations = editor.createDecorationsCollection();
  const disposables: Disposable[] = [];
  let model = editor.getModel();
  let file = model ? fileOf(model) : null;
  let cursorTimer: ReturnType<typeof setTimeout> | null = null;

  const pushContent = (): void => {
    if (model && file) controller.updateFile(file, model.getValue());
  };

  const paint = (): void => {
    if (!model || !file) return;
    const s = state.get();
    // markers for the active file
    const sev = (d: Diagnostic) => (d.severity === 'error' ? monaco.MarkerSeverity.Error : d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info);
    const markers = s.diagnostics
      .filter((d) => !d.file || d.file === file)
      .map((d) => ({
        severity: sev(d), message: d.message, source: 'Code Blocks',
        startLineNumber: d.line, startColumn: d.column, endLineNumber: d.line, endColumn: Math.max(d.column + 1, model!.getLineMaxColumn(d.line)),
      }));
    monaco.editor.setModelMarkers(model, owner, markers);

    // line highlights for the selected / running block
    const decos: unknown[] = [];
    const nodeById = (id: string | null) => (id && s.scene ? s.scene.nodes.find((n) => n.id === id) : undefined);
    const add = (id: string | null, className: string) => {
      const src = nodeById(id)?.src;
      if (src && src.file === file) {
        decos.push({ range: { startLineNumber: src.start, startColumn: 1, endLineNumber: src.end, endColumn: 1 }, options: { isWholeLine: true, className } });
      }
    };
    add(s.selectedId, cls.selected);
    if (s.runningId && s.runningId !== s.selectedId) add(s.runningId, cls.running);
    decorationsSet(decos);
  };

  const decorationsSet = (decos: unknown[]): void => decorations.set(decos);

  const setModel = (): void => {
    if (model) monaco.editor.setModelMarkers(model, owner, []);
    model = editor.getModel();
    file = model ? fileOf(model) : null;
    pushContent();
    paint();
  };

  disposables.push(editor.onDidChangeModelContent(pushContent));
  disposables.push(editor.onDidChangeModel(setModel));
  disposables.push(editor.onDidChangeCursorPosition((e) => {
    if (!file) return;
    if (cursorTimer) clearTimeout(cursorTimer);
    const at = file;
    cursorTimer = setTimeout(() => controller.selectByLocation(at, e.position.lineNumber), opts.cursorDebounceMs ?? 80);
  }));

  const unsubState = state.subscribe((s, prev) => {
    if (s.diagnostics !== prev.diagnostics || s.selectedId !== prev.selectedId || s.runningId !== prev.runningId || s.scene !== prev.scene) paint();
  });
  const unsubReveal = controller.onReveal((loc: SourceLoc) => {
    if (loc.file === file) editor.revealLineInCenterIfOutsideViewport(loc.start);
    else opts.openFile?.(loc.file, loc.start);
  });

  pushContent();
  paint();

  return {
    sync: setModel,
    dispose() {
      if (cursorTimer) clearTimeout(cursorTimer);
      unsubState();
      unsubReveal();
      for (const d of disposables) d.dispose();
      if (model) monaco.editor.setModelMarkers(model, owner, []);
      decorations.clear();
    },
  };
}
