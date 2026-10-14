// Structural checks on a Scene. Used by unit tests, the corpus runner (CI on real sketches) and — in
// development — by the runtime, so layout regressions are caught before a student ever sees them.

import type { Scene, SceneNode } from './types.ts';

export interface Violation {
  code: 'duplicate-id' | 'overlap' | 'outside-lane' | 'dangling-edge' | 'no-geometry' | 'diagonal' | 'upward' | 'crosses-node' | 'unreachable';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function validateScene(scene: Scene): Violation[] {
  const out: Violation[] = [];
  const byId = new Map<string, SceneNode>();
  for (const n of scene.nodes) {
    if (byId.has(n.id)) out.push({ code: 'duplicate-id', message: `duplicate node id ${n.id}`, nodeId: n.id });
    byId.set(n.id, n);
  }

  const byLane = new Map<string | undefined, SceneNode[]>();
  for (const n of scene.nodes) {
    const list = byLane.get(n.lane);
    if (list) list.push(n); else byLane.set(n.lane, [n]);
  }

  for (const [laneId, ns] of byLane) {
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i];
        const b = ns[j];
        const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0) out.push({ code: 'overlap', message: `${a.id} and ${b.id} overlap in ${laneId}`, nodeId: a.id });
      }
    }
  }

  for (const n of scene.nodes) {
    const l = scene.lanes.find((x) => x.id === n.lane);
    if (!l || n.x - n.w / 2 < l.x || n.x + n.w / 2 > l.x + l.w || n.y < l.y || n.y + n.h > l.y + l.h) {
      out.push({ code: 'outside-lane', message: `${n.id} escapes its lane`, nodeId: n.id });
    }
  }

  for (const e of scene.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) { out.push({ code: 'dangling-edge', message: `edge ${e.id} has an unknown endpoint`, edgeId: e.id }); continue; }
    if (e.points.length < 2) { out.push({ code: 'no-geometry', message: `edge ${e.id} has no geometry`, edgeId: e.id }); continue; }
    for (let i = 1; i < e.points.length; i++) {
      const [a, b] = [e.points[i - 1], e.points[i]];
      if (a[0] !== b[0] && a[1] !== b[1]) out.push({ code: 'diagonal', message: `edge ${e.id} has a diagonal segment`, edgeId: e.id });
      const [[x1, y1], [x2, y2]] = [a, b];
      for (const n of scene.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        const l = n.x - n.w / 2 + 1;
        const r = n.x + n.w / 2 - 1;
        const t = n.y + 1;
        const bt = n.y + n.h - 1;
        const hit = Math.max(Math.min(x1, x2), l) <= Math.min(Math.max(x1, x2), r) && Math.max(Math.min(y1, y2), t) <= Math.min(Math.max(y1, y2), bt);
        if (hit) out.push({ code: 'crosses-node', message: `edge ${e.id} (${e.from}→${e.to}, ${e.kind}) passes through ${n.id}`, edgeId: e.id, nodeId: n.id });
      }
    }
    if (e.kind !== 'back' && e.points[e.points.length - 1][1] < e.points[0][1]) {
      out.push({ code: 'upward', message: `forward edge ${e.id} runs upwards`, edgeId: e.id });
    }
  }

  const incoming = new Set(scene.edges.map((e) => e.to));
  for (const n of scene.nodes) {
    if (n.kind === 'start' || n.kind === 'globals') continue;
    if (!incoming.has(n.id)) out.push({ code: 'unreachable', message: `${n.id} (${n.kind}) has no incoming edge`, nodeId: n.id });
  }
  return out;
}
