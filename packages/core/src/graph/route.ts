// Orthogonal edge routing on absolute coordinates.
//
// Rules (all derived from the structured layout, so no crossing search is needed):
//   branch  decision -> child column: leave the bottom vertex, run along a bus just below it
//   flow    exit -> next node:        run along a merge bus just above the target, so several
//                                     branches joining one node form a clean bar
//   back    loop body -> loop head:   drop to a bus under the body, climb the right-hand lane, and
//                                     join the head's incoming vertical just above it
// If a structured route would clip an unrelated node, a bend-penalised Dijkstra re-routes that edge.

import type { Point } from '../types.ts';
import type { LEdge, LNode, Port } from './internal.ts';

const JUNCTION = 22;
/** Hard cap on search work per edge so a pathological sketch can never stall the worker. */
const MAX_POPS = 250_000;
const MAX_GRID = 200_000;

function port(n: LNode, which: Port): Point {
  switch (which) {
    case 'top': return [n.x, n.y];
    case 'left': return [n.x - n.w / 2, n.y + n.h / 2];
    case 'right': return [n.x + n.w / 2, n.y + n.h / 2];
    default: return [n.x, n.y + n.h];
  }
}

interface Rect { l: number; r: number; t: number; b: number }

const rectOf = (n: LNode, pad = 0): Rect => ({ l: n.x - n.w / 2 - pad, r: n.x + n.w / 2 + pad, t: n.y - pad, b: n.y + n.h + pad });

function segHits(x1: number, y1: number, x2: number, y2: number, r: Rect): boolean {
  // open-interval test; works for zero-width (vertical) and zero-height (horizontal) segments
  return Math.max(x1, x2) > r.l && Math.min(x1, x2) < r.r && Math.max(y1, y2) > r.t && Math.min(y1, y2) < r.b;
}

function hitsAny(pts: Point[], nodes: LNode[]): boolean {
  const rects = nodes.map((n) => rectOf(n, -1));
  for (let i = 1; i < pts.length; i++) for (const r of rects) if (segHits(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r)) return true;
  return false;
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

export function routeEdges(nodes: LNode[], edges: LEdge[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lanes = new Map<string | undefined, LNode[]>();
  for (const n of nodes) {
    const list = lanes.get(n.lane);
    if (list) list.push(n); else lanes.set(n.lane, [n]);
  }

  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) { e.points = []; e.labelAt = null; continue; }
    const [sx, sy] = port(a, e.fromPort ?? 'bottom');
    const [tx, ty] = port(b, 'top');
    const S: Point = [sx, sy];
    const T: Point = [tx, ty];
    let pts: Point[];
    let label: Point;

    if (e.kind === 'branch') {
      const bus = sy + JUNCTION;
      pts = sx === tx ? [S, T] : [S, [sx, bus], [tx, bus], T];
      label = sx === tx ? [sx, sy + 24] : [tx, bus + 24];
    } else if (e.kind === 'back') {
      const jy = ty - JUNCTION;
      const laneX = e.laneX ?? sx;
      if (e.fromPort === 'right') {
        pts = [S, [laneX, sy], [laneX, jy], [tx, jy], T];
        label = [laneX, sy - 20];
      } else {
        const bus = e.busY ?? sy + 12;
        const head: Point[] = e.fromPort === 'left' ? [S, [e.srcLaneX ?? sx, sy], [e.srcLaneX ?? sx, bus]] : [S, [sx, bus]];
        pts = [...head, [laneX, bus], [laneX, jy], [tx, jy], T];
        label = [laneX, (bus + jy) / 2];
      }
    } else if (e.fromPort === 'left' || e.fromPort === 'right') {
      const laneX = e.laneX ?? sx;
      const bus = Math.max(ty - JUNCTION, sy + 12);
      pts = [S, [laneX, sy], [laneX, bus], [tx, bus], T];
      label = [laneX, sy + 24];
    } else if (sx === tx) {
      pts = [S, T];
      label = [sx, Math.min(sy + 24, (sy + ty) / 2)];
    } else {
      const bus = Math.max(ty - JUNCTION, sy + 12);
      pts = [S, [sx, bus], [tx, bus], T];
      label = [sx, sy + 24];
    }
    e.points = dedupe(pts);
    e.labelAt = e.label ? label : null;

    const laneNodes = lanes.get(a.lane) ?? [];
    const others = laneNodes.filter((n) => n.id !== e.from && n.id !== e.to);
    if (hitsAny(e.points, others)) {
      const alt = searchRoute(e, laneNodes, e.kind === 'back');
      if (alt) {
        e.points = alt;
        if (e.label) {
          const seg = alt.findIndex((p, i) => i > 0 && Math.hypot(p[0] - alt[i - 1][0], p[1] - alt[i - 1][1]) > 40);
          const i = Math.max(1, seg);
          e.labelAt = [(alt[i][0] + alt[i - 1][0]) / 2, (alt[i][1] + alt[i - 1][1]) / 2];
        }
      }
    }
  }
}

/** Dijkstra over the grid spanned by obstacle sides; bends are penalised; forward edges never go up. */
function searchRoute(e: LEdge, nodes: LNode[], allowUp: boolean): Point[] | null {
  const PAD = 12;
  const BEND = 36;
  const rects = nodes.map((n) => rectOf(n, PAD));
  const first = e.points[0];
  const last = e.points[e.points.length - 1];
  const start: Point = e.fromPort === 'left' ? [first[0] - 14, first[1]] : e.fromPort === 'right' ? [first[0] + 14, first[1]] : [first[0], first[1] + 14];
  const goal: Point = [last[0], last[1] - 14];
  const xs = [...new Set([start[0], goal[0], first[0], ...(e.laneX != null ? [e.laneX] : []), ...rects.flatMap((r) => [r.l, r.r]), ...nodes.map((n) => n.x)])].sort((p, q) => p - q);
  const ys = [...new Set([start[1], goal[1], ...rects.flatMap((r) => [r.t, r.b])])].sort((p, q) => p - q);
  if (xs.length * ys.length > MAX_GRID) return null;
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const ny = ys.length;
  const id = (i: number, j: number, d: number) => (i * ny + j) * 2 + d; // d: 0 horizontal, 1 vertical
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap: [number, number][] = [];
  const push = (c: number, s: number) => {
    heap.push([c, s]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const end = heap.pop() as [number, number];
    if (heap.length) {
      heap[0] = end;
      let k = 0;
      for (;;) {
        let m = k;
        const l = 2 * k + 1;
        const r = l + 1;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const blocked = (x1: number, y1: number, x2: number, y2: number) => rects.some((r) => segHits(x1, y1, x2, y2, r));

  const si = xi.get(start[0]) as number;
  const sj = yi.get(start[1]) as number;
  const s0 = id(si, sj, e.fromPort === 'left' || e.fromPort === 'right' ? 0 : 1);
  dist.set(s0, 0);
  push(0, s0);
  const gi = xi.get(goal[0]) as number;
  const gj = yi.get(goal[1]) as number;
  let found: number | null = null;
  let pops = 0;
  while (heap.length) {
    if (++pops > MAX_POPS) return null;
    const [c, s] = pop();
    if (c > (dist.get(s) ?? Infinity)) continue;
    const d = s & 1;
    const cell = s >> 1;
    const i = Math.floor(cell / ny);
    const j = cell % ny;
    if (i === gi && j === gj) { found = s; break; }
    const relax = (ns: number, cost: number) => {
      const nc = c + cost;
      if (nc < (dist.get(ns) ?? Infinity)) { dist.set(ns, nc); prev.set(ns, s); push(nc, ns); }
    };
    relax(id(i, j, 1 - d), BEND);
    const steps: [number, number][] = d === 0 ? [[i - 1, j], [i + 1, j]] : [[i, j - 1], [i, j + 1]];
    for (const [ni, nj] of steps) {
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ny) continue;
      if (!allowUp && nj < j) continue;
      if (blocked(xs[i], ys[j], xs[ni], ys[nj])) continue;
      relax(id(ni, nj, d), Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]));
    }
  }
  if (found == null) return null;
  const path: Point[] = [];
  for (let s: number | undefined = found; s != null; s = prev.get(s)) {
    const cell = s >> 1;
    path.push([xs[Math.floor(cell / ny)], ys[cell % ny]]);
  }
  path.reverse();
  const pts = dedupe([first, ...path, last]);
  // drop collinear interior points
  return pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1][0] === p[0] && p[0] === pts[i + 1][0]) || (pts[i - 1][1] === p[1] && p[1] === pts[i + 1][1])));
}
