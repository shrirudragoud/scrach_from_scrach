// IR -> positioned scene.
//
// Source code is structured, so its control flow is series-parallel. That lets us lay it out with a
// deterministic recursive box model instead of a general graph-layout engine:
//
//   Block = { nodes, edges, regions, L, R, H, entry, exits }
//     - every block is laid out around a vertical axis x = 0 (L/R = extent left/right of it), top y = 0
//     - `entry` is the node that receives the incoming edge, `exits` are dangling ends that the next
//       sibling (or the enclosing construct) connects to
//   sequence  -> stack blocks vertically on the same axis
//   if/else   -> question on the axis, `yes` column left, `no` column right, a free corridor between
//   loop      -> question + body below it inside a tinted region; back-edge climbs a right-hand lane
//   switch    -> question with one column per case
//
// Edges are logical here (from/to ids + kind); route.ts turns them into orthogonal polylines once
// absolute coordinates are known.
//
// `mode: 'kids'` writes plain-English text on the blocks and shows the real code underneath;
// `mode: 'code'` writes the technical text only.

import { kindMeta, CATEGORY_EMOJI } from '../kinds.ts';
import { EXPLAIN } from '../profiles/plain.ts';
import { wrap, truncate } from '../text.ts';
import { routeEdges } from './route.ts';
import { AnalyzeError, DEFAULT_LIMITS, DEFAULT_METRICS, SCENE_VERSION } from '../types.ts';
import type {
  ActionStmt, IfStmt, Limits, LoopStmt, NodeKind, Program, Scene, SceneEdge, SceneLane, SceneLink, SceneMode, SceneRegion, Stmt,
  SwitchStmt, TextMetrics, Func,
} from '../types.ts';
import type { LEdge, LNode, Port } from './internal.ts';

export const G = {
  CARD_W: 300,
  GAP_Y: 46,
  GAP_X: 44,
  BRANCH_GAP: 74,
  LANE_M: 28,
  REGION_PAD: 20,
  PANEL_PAD: 44,
  PANEL_GAP: 70,
  PANEL_HEADER: 92,
  PANEL_MIN_W: 360,
} as const;

export interface LayoutOptions {
  mode?: SceneMode;
  showCode?: boolean;
  metrics?: Partial<TextMetrics>;
  limits?: Partial<Limits>;
}

interface Exit {
  id: string;
  port?: Port;
  laneX?: number;
  label?: string;
}

interface Block {
  nodes: LNode[];
  edges: LEdge[];
  regions: SceneRegion[];
  L: number;
  R: number;
  H: number;
  entry: string | null;
  exits: Exit[];
  empty: boolean;
}

interface Ctx {
  breaks: Exit[] | null;
  continues: Exit[] | null;
}

// ---------------------------------------------------------------------------------------------
// block algebra (pure)
// ---------------------------------------------------------------------------------------------

const emptyBlock = (): Block => ({ nodes: [], edges: [], regions: [], L: 0, R: 0, H: 0, entry: null, exits: [], empty: true });

const single = (node: LNode): Block => ({
  nodes: [node], edges: [], regions: [], empty: false, entry: node.id, exits: [{ id: node.id }], H: node.h, L: node.w / 2, R: node.w / 2,
});

const terminal = (node: LNode): Block => ({ ...single(node), exits: [] });

function shift(b: Block, dx: number, dy: number): void {
  for (const n of b.nodes) { n.x += dx; n.y += dy; }
  for (const r of b.regions) { r.x += dx; r.y += dy; }
  for (const e of b.edges) {
    if (e.laneX != null) e.laneX += dx;
    if (e.srcLaneX != null) e.srcLaneX += dx;
    if (e.busY != null) e.busY += dy;
  }
  for (const x of b.exits) if (x.laneX != null) x.laneX += dx;
}

const tone = (label: string): 'yes' | 'no' | null => (label === 'yes' ? 'yes' : label === 'no' ? 'no' : null);

function edge(p: Pick<LEdge, 'from' | 'to' | 'kind'> & Partial<LEdge>): LEdge {
  return { id: '', fromPort: 'bottom', label: '', tone: null, points: [], labelAt: null, ...p };
}

const branchEdge = (from: string, to: string, label: string): LEdge => edge({ from, to, kind: 'branch', label, tone: tone(label) });

function connect(exits: Exit[], to: string, edges: LEdge[]): void {
  for (const x of exits) {
    edges.push(edge({ from: x.id, to, kind: 'flow', fromPort: x.port ?? 'bottom', laneX: x.laneX, label: x.label ?? '', tone: tone(x.label ?? '') }));
  }
}

/** Stack blocks vertically; stops at the first block that cannot fall through (return/break/...). */
function stack(blocks: Block[]): Block {
  const out = emptyBlock();
  for (const b of blocks) {
    if (b.empty) continue;
    if (!out.empty && out.exits.length === 0) break; // unreachable
    const y = out.empty ? 0 : out.H + G.GAP_Y;
    if (!out.empty && b.entry) connect(out.exits, b.entry, out.edges);
    shift(b, 0, y);
    out.nodes.push(...b.nodes);
    out.edges.push(...b.edges);
    out.regions.push(...b.regions);
    out.L = Math.max(out.L, b.L);
    out.R = Math.max(out.R, b.R);
    out.H = y + b.H;
    if (out.empty) out.entry = b.entry;
    out.exits = b.exits;
    out.empty = false;
  }
  return out;
}

function place(out: Block, b: Block, dx: number, dy: number): void {
  shift(b, dx, dy);
  out.nodes.push(...b.nodes);
  out.edges.push(...b.edges);
  out.regions.push(...b.regions);
}

const oneLine = (t: string | undefined): string => truncate(String(t ?? '').replace(/;\s*$/, ''), 120);
const explainFor = (kind: NodeKind, category?: string): string => (category && EXPLAIN[`${kind}:${category}`]) || EXPLAIN[kind] || '';

const ROLE_RANK: Record<string, number> = { setup: 0, loop: 1, isr: 2, callback: 3, user: 4 };
const shortName = (fn: Func): string => `${fn.name}(${fn.params.map((p) => p.split(/\s+/).pop()?.replace(/[*&[\]]/g, '') ?? '').filter(Boolean).join(', ')})`;

// ---------------------------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------------------------

class SceneBuilder {
  private uid = 0;
  private readonly mode: SceneMode;
  private readonly showCode: boolean;
  private readonly m: TextMetrics;
  private readonly limits: Limits;

  constructor(options: LayoutOptions) {
    this.mode = options.mode ?? 'kids';
    this.showCode = options.showCode ?? true;
    this.m = { ...DEFAULT_METRICS, ...options.metrics };
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  private get kids(): boolean { return this.mode === 'kids'; }

  private nid(): string {
    if (++this.uid > this.limits.maxNodes) {
      throw new AnalyzeError('too-complex', `This program has more than ${this.limits.maxNodes} blocks — too many to draw at once.`);
    }
    return `n${this.uid}`;
  }

  // ---- node factories (x = centre, y = top; relative until the lane is assembled) ---------------

  private cardNode(s: Pick<ActionStmt, 'kind' | 'title' | 'friendly' | 'sub' | 'text' | 'lines' | 'friendlyLines' | 'category' | 'explain' | 'warn' | 'error' | 'ref' | 'loc'>, width: number = G.CARD_W, maxLines = 6, shown = maxLines): LNode {
    const meta = kindMeta(s.kind);
    const category = s.category || meta.label;
    const title = this.kids ? s.friendly || s.title : s.title;
    const sub = this.kids ? (s.sub && s.sub.startsWith('#') ? s.sub : '') : s.sub;
    const textW = width - 68 - 14;
    const chars = Math.floor(textW / this.m.title);
    const monoChars = Math.floor((textW - 16) / this.m.mono);
    const titleLines = wrap(title, chars, 3);
    const subLines = sub ? wrap(sub, Math.floor(textW / this.m.small), 1) : [];
    const code = this.kids && this.showCode && s.text && !s.lines ? truncate(oneLine(s.text), monoChars) : null;
    const raw = (this.kids ? s.friendlyLines : undefined) || s.lines || [];
    const lines = raw.length > maxLines
      ? [...raw.slice(0, shown).map((l) => wrap(l, chars + 4, 1)[0] ?? ''), `+ ${raw.length - shown} more`]
      : raw.map((l) => wrap(l, chars + 4, 1)[0] ?? '');
    const h = Math.max(66, 12 + 13 + 6 + titleLines.length * 19 + (subLines.length ? 17 : 0) + (code ? 32 : 0) + (lines.length ? lines.length * 18 + 6 : 0) + 14);
    return {
      id: this.nid(), kind: s.kind, shape: 'card', x: 0, y: 0, w: width, h,
      category: String(category).toUpperCase(), emoji: CATEGORY_EMOJI[category] || meta.emoji,
      titleLines, subLines, code, lines, explain: s.explain || explainFor(s.kind, category),
      loc: s.loc, warn: s.warn, error: s.error, ref: s.ref || null, text: s.text,
    };
  }

  private hexNode(kind: 'decision' | 'loop' | 'switch', title: string, sub: string | undefined | null, loc: ActionStmt['loc'], text: string): LNode {
    const meta = kindMeta(kind);
    const titleLines = wrap(title, Math.floor(200 / this.m.title), 3);
    const subLines = sub ? [truncate(sub, Math.floor(226 / this.m.small))] : [];
    const h = Math.max(70, 26 + titleLines.length * 19 + (subLines.length ? 17 : 0) + 18);
    return {
      id: this.nid(), kind, shape: 'hex', x: 0, y: 0, w: 300, h, emoji: meta.emoji, titleLines, subLines, loc, text,
      category: meta.label.toUpperCase(), explain: explainFor(kind), lines: [], code: null, ref: null,
    };
  }

  private pillNode(kind: NodeKind, title: string, loc?: ActionStmt['loc']): LNode {
    const meta = kindMeta(kind);
    return {
      id: this.nid(), kind, shape: 'pill', x: 0, y: 0, w: Math.min(260, Math.max(150, title.length * (this.m.title + 0.1) + 76)), h: 44, emoji: meta.emoji,
      titleLines: [truncate(title, 28)], subLines: [], lines: [], code: null, category: meta.label.toUpperCase(), explain: explainFor(kind), loc, ref: null,
    };
  }

  private hatNode(title: string, emoji: string): LNode {
    const lines = wrap(title, Math.floor(200 / this.m.title), 2);
    return {
      id: this.nid(), kind: 'start', shape: 'hat', x: 0, y: 0, w: 280, h: 28 + lines.length * 19 + 14, emoji, titleLines: lines, subLines: [], lines: [], code: null,
      category: 'START', explain: EXPLAIN.start, ref: null,
    };
  }

  // ---- statements -----------------------------------------------------------------------------

  private seq(list: Stmt[], ctx: Ctx): Block {
    // In kids mode a recognised counting loop hides its `i = 0` / `i++` plumbing: "Repeat 3 times" says it all.
    const visible = this.kids
      ? list.filter((s, i) => {
          const next = list[i + 1];
          return !(s.t === 'action' && s.role === 'loop-init' && next?.t === 'loop' && next.count);
        })
      : list;
    return stack(visible.map((s) => this.stmt(s, ctx)));
  }

  private stmt(s: Stmt, ctx: Ctx): Block {
    switch (s.t) {
      case 'action': return single(this.cardNode(s));
      case 'return':
        return terminal(this.pillNode('return', this.kids ? (s.value ? `Give back ${s.value}` : 'Finish here') : s.value ? `return ${s.value}` : 'return', s.loc));
      case 'break': {
        const n = this.pillNode('break', this.kids ? 'Stop the loop' : 'break', s.loc);
        ctx.breaks?.push({ id: n.id });
        return terminal(n);
      }
      case 'continue': {
        const n = this.pillNode('continue', this.kids ? 'Skip to next round' : 'continue', s.loc);
        ctx.continues?.push({ id: n.id });
        return terminal(n);
      }
      case 'if': return this.ifBlock(s, ctx);
      case 'loop': return this.loopBlock(s, ctx);
      case 'switch': return this.switchBlock(s, ctx);
      default: return emptyBlock();
    }
  }

  private ifBlock(s: IfStmt, ctx: Ctx): Block {
    const D = this.hexNode('decision', this.kids ? s.friendly : s.cond, null, s.headLoc, s.cond);
    const yes = this.seq(s.then, ctx);
    const no = this.seq(s.else, ctx);
    const out: Block = { ...emptyBlock(), empty: false, nodes: [D], entry: D.id };
    const half = G.GAP_X / 2;
    const top = D.h + G.BRANCH_GAP;
    let L = D.w / 2;
    let R = D.w / 2;
    let bottom = D.h;
    const exits: Exit[] = [];

    if (!yes.empty && yes.entry) {
      const x = -(half + yes.R);
      place(out, yes, x, top);
      out.edges.push(branchEdge(D.id, yes.entry, 'yes'));
      exits.push(...yes.exits);
      L = Math.max(L, -x + yes.L);
      bottom = Math.max(bottom, top + yes.H);
    } else exits.push({ id: D.id, label: 'yes' });

    if (!no.empty && no.entry) {
      const x = half + no.L;
      place(out, no, x, top);
      out.edges.push(branchEdge(D.id, no.entry, 'no'));
      exits.push(...no.exits);
      R = Math.max(R, x + no.R);
      bottom = Math.max(bottom, top + no.H);
    } else exits.push({ id: D.id, label: 'no' });

    return Object.assign(out, { L, R, H: bottom, exits });
  }

  private loopBlock(s: LoopStmt, ctx: Ctx): Block {
    void ctx;
    const forever = s.form === 'for' && s.cond === 'forever';
    const infinite = forever || (s.form !== 'do' && /^(true|1)$/.test(s.cond));
    const sub = this.kids
      ? s.friendlySub || (s.form === 'while' && !infinite ? 'checks first, then repeats' : '')
      : { while: 'while loop', for: 'for loop', do: 'do-while', range: 'for-each' }[s.form];
    const D = this.hexNode('loop', this.kids ? s.friendly : forever ? 'forever' : s.cond, sub, s.headLoc, s.cond);
    const bctx: Ctx = { breaks: [], continues: [] };
    const bodyStmts = this.kids && s.count ? s.body.filter((b) => !(b.t === 'action' && b.role === 'loop-step')) : s.body;
    const body = this.seq(bodyStmts, bctx);
    const out: Block = { ...emptyBlock(), empty: false, nodes: [D] };
    const lane = G.LANE_M;
    const pad = G.REGION_PAD;
    const region = (x1: number, x2: number, y1: number, y2: number): SceneRegion => ({ kind: 'loop', x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    const breaks = bctx.breaks ?? [];
    const continues = bctx.continues ?? [];

    if (body.empty || !body.entry) return Object.assign(out, { entry: D.id, L: D.w / 2, R: D.w / 2, H: D.h, exits: [{ id: D.id }] });

    if (s.form === 'do') {
      place(out, body, 0, 0);
      const dy = body.H + G.GAP_Y;
      D.y = dy;
      connect([...body.exits, ...continues], D.id, out.edges);
      const laneR = Math.max(body.R, D.w / 2) + lane;
      const left = Math.max(body.L, D.w / 2);
      out.edges.push(edge({ from: D.id, to: body.entry, kind: 'back', fromPort: 'right', laneX: laneR, label: 'again' }));
      out.regions.unshift(region(-left - pad, laneR + pad, -16, dy + D.h + 26));
      return Object.assign(out, {
        entry: body.entry, L: left + pad + 2, R: laneR + pad + 2, H: dy + D.h,
        exits: [{ id: D.id, label: 'no' }, ...breaks],
      });
    }

    const bodyTop = D.h + 60;
    place(out, body, 0, bodyTop);
    out.edges.push(branchEdge(D.id, body.entry, 'yes'));
    const laneR = Math.max(body.R, D.w / 2) + lane;
    const laneL = -(Math.max(body.L, D.w / 2) + lane);
    const H = bodyTop + body.H;
    for (const src of [...body.exits, ...continues]) {
      out.edges.push(edge({ from: src.id, to: D.id, kind: 'back', fromPort: src.port ?? 'bottom', srcLaneX: src.laneX, laneX: laneR, busY: H + 12 }));
    }
    out.regions.unshift(region(laneL - pad, laneR + pad, -16, H + 26));
    return Object.assign(out, {
      entry: D.id, L: -laneL + pad + 2, R: laneR + pad + 2, H,
      exits: [...(infinite ? [] : [{ id: D.id, port: 'left' as const, laneX: laneL, label: 'no' }]), ...breaks],
    });
  }

  private switchBlock(s: SwitchStmt, ctx: Ctx): Block {
    const D = this.hexNode('switch', this.kids ? s.friendly : s.expr, this.kids ? '' : 'switch', s.headLoc, s.expr);
    const sctx: Ctx = { breaks: [], continues: ctx.continues };
    const cols = s.cases.map((c) => ({ c, b: this.seq(c.body, sctx) }));
    const filled = cols.filter((c) => !c.b.empty);
    const caseLabel = (c: SwitchStmt['cases'][number]) => truncate(this.kids ? c.friendlyLabel : c.labels.join(', '), 22);
    const straight: string[] = [];
    if (!s.cases.some((c) => c.isDefault)) straight.push(this.kids ? 'anything else' : 'other');
    for (const c of cols) if (c.b.empty) straight.push(caseLabel(c.c));

    const out: Block = { ...emptyBlock(), empty: false, nodes: [D], entry: D.id };
    const half = G.GAP_X / 2;
    const top = D.h + G.BRANCH_GAP;
    const nLeft = Math.ceil(filled.length / 2);
    const left = filled.slice(0, nLeft);
    const right = filled.slice(nLeft);
    let L = D.w / 2;
    let R = D.w / 2;
    let bottom = D.h;
    const exits: Exit[] = [];

    const attach = (col: (typeof cols)[number], x: number) => {
      if (!col.b.entry) return;
      place(out, col.b, x, top);
      out.edges.push(branchEdge(D.id, col.b.entry, caseLabel(col.c)));
      exits.push(...col.b.exits);
      L = Math.max(L, -(x - col.b.L));
      R = Math.max(R, x + col.b.R);
      bottom = Math.max(bottom, top + col.b.H);
    };
    let cur = -half;
    for (const col of [...left].reverse()) { const x = cur - col.b.R; attach(col, x); cur = x - col.b.L - G.GAP_X; }
    cur = half;
    for (const col of right) { const x = cur + col.b.L; attach(col, x); cur = x + col.b.R + G.GAP_X; }

    if (straight.length) exits.push({ id: D.id, label: truncate(straight.join(', '), 22) });
    exits.push(...(sctx.breaks ?? []));
    return Object.assign(out, { L, R, H: bottom, exits });
  }

  // ---- functions -> lanes -> scene ----------------------------------------------------------------

  private functionBlock(fn: Func): Block {
    const start = this.hatNode(fn.startLabel || 'Start', fn.startEmoji || '🏁');
    const body = this.seq(fn.body, { breaks: null, continues: null });
    let top = stack([single(start), body]);
    if (fn.repeats && !body.empty && body.entry) {
      const laneR = top.R + G.LANE_M;
      for (const src of top.exits) {
        top.edges.push(edge({ from: src.id, to: body.entry, kind: 'back', fromPort: src.port ?? 'bottom', laneX: laneR, busY: top.H + 12, label: 'again' }));
      }
      top.exits = [];
      top.R = laneR + 6;
    } else if (top.exits.length) {
      top = stack([top, single(this.pillNode('end', fn.endTitle || (this.kids ? 'The end' : 'End'), fn.loc))]);
    }
    return top;
  }

  build(program: Program): Scene {
    const lanes: SceneLane[] = [];
    const blocks: Block[] = [];

    if (program.globals.length) {
      const lines = program.globals.map((g) => (this.kids ? g.friendly || g.text : g.text));
      const node = this.cardNode({
        kind: 'globals', category: this.kids ? 'What the program knows' : 'Globals', title: this.kids ? 'Names & tools' : `${program.globals.length} declarations`,
        text: '', lines, friendlyLines: lines, loc: { start: program.globals[0].line, end: program.globals[program.globals.length - 1].line },
      }, 340, 14, 13);
      lanes.push({
        id: 'globals', name: this.kids ? 'Before we start' : 'Globals', role: 'globals', x: 0, y: 0, w: 0, h: 0,
        description: this.kids ? 'Libraries, names for pins, and variables' : 'Includes, defines, variables',
      });
      blocks.push(single(node));
    }

    const fns = program.functions
      .map((f, i) => ({ f, i }))
      .sort((a, b) => (ROLE_RANK[a.f.role] ?? 9) - (ROLE_RANK[b.f.role] ?? 9) || a.i - b.i)
      .map((x) => x.f);

    for (const fn of fns) {
      lanes.push({ id: `fn:${fn.name}`, name: this.kids ? shortName(fn) : fn.signature, fn: fn.name, description: fn.description, role: fn.role, loc: fn.loc, x: 0, y: 0, w: 0, h: 0 });
      blocks.push(this.functionBlock(fn));
    }

    const nodes: LNode[] = [];
    const edges: LEdge[] = [];
    const regions: SceneRegion[] = [];
    const contentTop = G.PANEL_HEADER + 22;
    let x = 0;
    let maxH = 0;
    blocks.forEach((b, i) => {
      const lane = lanes[i];
      const natural = b.L + b.R + 2 * G.PANEL_PAD;
      const w = Math.max(natural, G.PANEL_MIN_W);
      lane.x = x;
      lane.y = 0;
      lane.w = w;
      const axis = x + (w - natural) / 2 + G.PANEL_PAD + b.L;
      shift(b, axis, contentTop);
      for (const n of b.nodes) n.lane = lane.id;
      nodes.push(...b.nodes);
      edges.push(...b.edges);
      regions.push(...b.regions);
      maxH = Math.max(maxH, contentTop + b.H + G.PANEL_PAD + 20);
      x += w + G.PANEL_GAP;
    });
    for (const l of lanes) l.h = maxH;

    edges.forEach((e, i) => { e.id = `e${i + 1}`; });
    routeEdges(nodes, edges);

    const byFn = new Map(lanes.filter((l) => l.fn).map((l) => [l.fn as string, l]));
    const links: SceneLink[] = nodes
      .filter((n) => n.ref && byFn.has(n.ref))
      .map((n) => ({ from: n.id, toLane: (byFn.get(n.ref as string) as SceneLane).id, kind: n.kind }));

    // strip layout-internal fields: the Scene is the public contract
    const sceneEdges: SceneEdge[] = edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, label: e.label, tone: e.tone, points: e.points, labelAt: e.labelAt }));

    return {
      version: SCENE_VERSION,
      mode: this.mode,
      language: program.language,
      lanes,
      nodes,
      edges: sceneEdges,
      regions,
      links,
      bounds: { w: Math.max(0, x - G.PANEL_GAP), h: maxH },
    };
  }
}

export function buildScene(program: Program, options: LayoutOptions = {}): Scene {
  return new SceneBuilder(options).build(program);
}
