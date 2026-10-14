// Multi-file projects. Arduino concatenates a sketch's .ino tabs (main tab first, the rest in
// alphabetical order) before compiling; we do the same and keep a line map so every block, lane and
// diagnostic can point back at the *file and line the student actually sees in their editor*.

import type { Diagnostic, Loc, ProjectFile, SourceLoc } from './types.ts';

export interface Segment {
  file: string;
  /** 1-based first line of this file inside the combined source. */
  start: number;
  /** Number of lines this file occupies in the combined source. */
  lines: number;
}

export interface CombinedSource {
  source: string;
  segments: Segment[];
}

const hasExt = (name: string, exts: string[]): boolean => exts.some((e) => name.toLowerCase().endsWith(e));

export function combineFiles(files: ProjectFile[], extensions: string[], main?: string): CombinedSource {
  const eligible = files.filter((f) => hasExt(f.name, extensions));
  const mainFile = main ? eligible.find((f) => f.name === main) : eligible[0];
  const rest = eligible.filter((f) => f !== mainFile).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const ordered = mainFile ? [mainFile, ...rest] : rest;

  const segments: Segment[] = [];
  const parts: string[] = [];
  let line = 1;
  for (const f of ordered) {
    const lines = f.content.split('\n').length;
    segments.push({ file: f.name, start: line, lines });
    parts.push(f.content);
    line += lines;
  }
  return { source: parts.join('\n'), segments };
}

export function locate(segments: Segment[], line: number): { file: string; line: number } | null {
  for (const s of segments) {
    if (line >= s.start && line < s.start + s.lines) return { file: s.file, line: line - s.start + 1 };
  }
  return null;
}

/** Map a combined-source range to the file it starts in (clamped to that file). */
export function mapLoc(segments: Segment[], loc: Loc | undefined): SourceLoc | undefined {
  if (!loc) return undefined;
  const seg = segments.find((s) => loc.start >= s.start && loc.start < s.start + s.lines);
  if (!seg) return undefined;
  const last = seg.start + seg.lines - 1;
  return { file: seg.file, start: loc.start - seg.start + 1, end: Math.min(loc.end, last) - seg.start + 1 };
}

export function mapDiagnostics(segments: Segment[], diags: Diagnostic[]): Diagnostic[] {
  return diags.map((d) => {
    const at = locate(segments, d.line);
    return at ? { ...d, file: at.file, line: at.line } : d;
  });
}

/** Inverse of mapLoc: where does `file:line` live in the combined source? */
export function toCombinedLine(segments: Segment[], file: string, line: number): number | null {
  const seg = segments.find((s) => s.file === file);
  return seg ? seg.start + line - 1 : null;
}
