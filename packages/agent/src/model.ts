// Turns a Scene into small, stable, JSON-friendly facts an agent can reason about.
// Pure functions: no DOM, no handle, no network. Block ids are regenerated on every analysis; the
// `where` ({file, line}) of a block is the stable way to refer to it across edits.

import type { Scene, SceneEdge, SceneLane, SceneNode } from '@codeblocks/core';

export interface Where {
  file: string;
  line: number;
  endLine: number;
}

export interface BlockRef {
  id: string;
  kind: string;
  title: string;
  where?: Where;
}

export interface FunctionSummary {
  name: string;
  /** setup | loop | isr | callback | user | globals */
  role: string;
  description?: string;
  blocks: number;
  where?: Where;
  /** Functions this one runs (by name). */
  calls: string[];
  calledBy: string[];
}

export interface Warning extends BlockRef {
  message: string;
  severity: 'warning' | 'error';
}

export interface ProgramSummary {
  language: string;
  blocks: number;
  functions: FunctionSummary[];
  warnings: Warning[];
}

export interface FlowStep extends BlockRef {
  /** Where control goes next; `label` is yes/no/case text for branches, `back` marks a loop-back. */
  next: { to: string; label?: string; back?: boolean }[];
}

export interface Flow {
  function: string;
  role: string;
  description?: string;
  steps: FlowStep[];
  truncated: boolean;
}

export interface BlockDetail extends BlockRef {
  function?: string;
  category: string;
  explain: string;
  /** Extra lines under the title (parameters, conditions). */
  details: string[];
  /** The original source text of this statement. */
  code?: string;
  /** Name of the function this block runs, if it is a call. */
  calls?: string;
  warning?: string;
  error?: string;
  next: { label?: string; back?: boolean; block: BlockRef }[];
  previous: BlockRef[];
  selected?: boolean;
  running?: boolean;
}

const titleOf = (n: SceneNode): string => n.titleLines.join(' ');

export function whereOf(n: { src?: { file: string; start: number; end: number } }): Where | undefined {
  return n.src ? { file: n.src.file, line: n.src.start, endLine: n.src.end } : undefined;
}

export function refOf(n: SceneNode): BlockRef {
  const where = whereOf(n);
  return where ? { id: n.id, kind: n.kind, title: titleOf(n), where } : { id: n.id, kind: n.kind, title: titleOf(n) };
}

interface Index {
  byId: Map<string, SceneNode>;
  out: Map<string, SceneEdge[]>;
  into: Map<string, SceneEdge[]>;
  laneOf: Map<string, SceneLane>;
}

const cache = new WeakMap<Scene, Index>();

function index(scene: Scene): Index {
  let ix = cache.get(scene);
  if (ix) return ix;
  ix = { byId: new Map(scene.nodes.map((n) => [n.id, n])), out: new Map(), into: new Map(), laneOf: new Map(scene.lanes.map((l) => [l.id, l])) };
  for (const e of scene.edges) {
    (ix.out.get(e.from) ?? ix.out.set(e.from, []).get(e.from)!).push(e);
    (ix.into.get(e.to) ?? ix.into.set(e.to, []).get(e.to)!).push(e);
  }
  cache.set(scene, ix);
  return ix;
}

export function getBlock(scene: Scene, id: string): SceneNode | undefined {
  return index(scene).byId.get(id);
}

const nameOfLane = (l: SceneLane): string => l.fn ?? l.name;

export function summarize(scene: Scene, { maxWarnings = 20 }: { maxWarnings?: number } = {}): ProgramSummary {
  const ix = index(scene);
  const counts = new Map<string, number>();
  const calls = new Map<string, Set<string>>();
  for (const n of scene.nodes) {
    if (!n.lane) continue;
    counts.set(n.lane, (counts.get(n.lane) ?? 0) + 1);
    if (n.ref) {
      const target = scene.lanes.find((l) => l.fn === n.ref);
      const from = ix.laneOf.get(n.lane);
      if (target && from) (calls.get(nameOfLane(from)) ?? calls.set(nameOfLane(from), new Set()).get(nameOfLane(from))!).add(nameOfLane(target));
    }
  }
  const calledBy = new Map<string, Set<string>>();
  for (const [from, to] of calls) for (const t of to) (calledBy.get(t) ?? calledBy.set(t, new Set()).get(t)!).add(from);

  const functions: FunctionSummary[] = scene.lanes.map((l) => {
    const name = nameOfLane(l);
    const f: FunctionSummary = { name, role: l.role, blocks: counts.get(l.id) ?? 0, calls: [...(calls.get(name) ?? [])], calledBy: [...(calledBy.get(name) ?? [])] };
    if (l.description) f.description = l.description;
    const where = whereOf(l);
    if (where) f.where = where;
    return f;
  });

  const warnings: Warning[] = [];
  for (const n of scene.nodes) {
    const message = n.error ?? n.warn;
    if (message && warnings.length < maxWarnings) warnings.push({ ...refOf(n), message, severity: n.error ? 'error' : 'warning' });
  }
  return { language: scene.language, blocks: scene.nodes.length, functions, warnings };
}

/** Blocks of one function in execution order (depth-first from its Start block, forward edges first). */
export function getFlow(scene: Scene, fn: string, { maxBlocks = 120 }: { maxBlocks?: number } = {}): Flow | undefined {
  const ix = index(scene);
  const lane = scene.lanes.find((l) => l.fn === fn) ?? scene.lanes.find((l) => l.name === fn);
  if (!lane) return undefined;
  const inLane = scene.nodes.filter((n) => n.lane === lane.id);
  const start = inLane.find((n) => n.kind === 'start') ?? inLane[0];
  const order: SceneNode[] = [];
  const seen = new Set<string>();
  const stack: SceneNode[] = start ? [start] : [];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    order.push(n);
    const edges = (ix.out.get(n.id) ?? []).filter((e) => e.kind !== 'back');
    for (let i = edges.length - 1; i >= 0; i--) {
      const t = ix.byId.get(edges[i].to);
      if (t && t.lane === lane.id) stack.push(t);
    }
  }
  for (const n of [...inLane].sort((a, b) => a.y - b.y || a.x - b.x)) if (!seen.has(n.id)) order.push(n);

  const steps: FlowStep[] = order.slice(0, maxBlocks).map((n) => ({
    ...refOf(n),
    next: (ix.out.get(n.id) ?? []).map((e) => ({ to: e.to, ...(e.label ? { label: e.label } : {}), ...(e.kind === 'back' ? { back: true } : {}) })),
  }));
  const flow: Flow = { function: nameOfLane(lane), role: lane.role, steps, truncated: order.length > maxBlocks };
  if (lane.description) flow.description = lane.description;
  return flow;
}

export function describeBlock(scene: Scene, id: string, state?: { selectedId?: string | null; runningId?: string | null }): BlockDetail | undefined {
  const ix = index(scene);
  const n = ix.byId.get(id);
  if (!n) return undefined;
  const lane = n.lane ? ix.laneOf.get(n.lane) : undefined;
  const detail: BlockDetail = {
    ...refOf(n),
    category: n.category,
    explain: n.explain,
    details: [...n.subLines, ...n.lines],
    next: (ix.out.get(id) ?? []).flatMap((e) => {
      const t = ix.byId.get(e.to);
      return t ? [{ ...(e.label ? { label: e.label } : {}), ...(e.kind === 'back' ? { back: true } : {}), block: refOf(t) }] : [];
    }),
    previous: (ix.into.get(id) ?? []).flatMap((e) => { const f = ix.byId.get(e.from); return f ? [refOf(f)] : []; }),
  };
  if (lane) detail.function = nameOfLane(lane);
  const code = n.text ?? n.code;
  if (code) detail.code = code;
  if (n.ref) detail.calls = n.ref;
  if (n.warn) detail.warning = n.warn;
  if (n.error) detail.error = n.error;
  if (state?.selectedId === id) detail.selected = true;
  if (state?.runningId === id) detail.running = true;
  return detail;
}

export function findBlocks(scene: Scene, query: string, { kind, limit = 20 }: { kind?: string; limit?: number } = {}): { matches: BlockRef[]; total: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: BlockRef[] = [];
  let total = 0;
  for (const n of scene.nodes) {
    if (kind && n.kind !== kind) continue;
    const hay = `${titleOf(n)} ${n.subLines.join(' ')} ${n.category} ${n.explain} ${n.text ?? ''} ${n.ref ?? ''}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    total++;
    if (hits.length < limit) hits.push(refOf(n));
  }
  return { matches: hits, total };
}

/** Compact plain-text rendering of a summary, for pasting into a system prompt or a chat message. */
export function summaryToText(s: ProgramSummary): string {
  const lines = [`Block view (${s.language}, ${s.blocks} blocks)`];
  for (const f of s.functions) {
    const at = f.where ? ` ${f.where.file}:${f.where.line}` : '';
    const rel = [f.calls.length ? `runs ${f.calls.join(', ')}` : '', f.calledBy.length ? `used by ${f.calledBy.join(', ')}` : ''].filter(Boolean).join('; ');
    lines.push(`- ${f.name} [${f.role}]${at} — ${f.blocks} blocks${f.description ? `, ${f.description}` : ''}${rel ? ` (${rel})` : ''}`);
  }
  for (const w of s.warnings) lines.push(`! ${w.severity} at ${w.where ? `${w.where.file}:${w.where.line}` : w.id}: ${w.message}`);
  return lines.join('\n');
}
