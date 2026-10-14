// A "guided run" through the scene: the sequence of blocks the board would execute, so a learner can
// watch the code run. Questions alternate yes/no on successive visits, loops go round twice, switches
// cycle through their cases, and calls to the learner's own blocks are followed inline.
// (This is a walkthrough, not an interpreter: it never evaluates conditions.)

import type { Scene, SceneEdge, SceneNode } from '../types.ts';

export interface TourStep {
  node: SceneNode;
  /** The edge that was followed to arrive here (null for the first step of a lane). */
  via: SceneEdge | null;
}

export interface TourOptions {
  /** Lane ids to walk, in order. Defaults to setup then loop. */
  lanes?: string[];
  maxSteps?: number;
}

export function buildTour(scene: Scene, { lanes, maxSteps = 70 }: TourOptions = {}): TourStep[] {
  const out = new Map<string, SceneEdge[]>();
  for (const e of scene.edges) {
    const list = out.get(e.from);
    if (list) list.push(e); else out.set(e.from, [e]);
  }
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const startOf = (laneId: string) => scene.nodes.find((n) => n.lane === laneId && n.kind === 'start');
  const wanted = lanes ?? scene.lanes.filter((l) => l.role === 'setup' || l.role === 'loop').map((l) => l.id);
  const steps: TourStep[] = [];

  function walk(startNode: SceneNode, depth: number): void {
    const visits = new Map<string, number>();
    let node: SceneNode | undefined = startNode;
    let via: SceneEdge | null = null;
    while (node && steps.length < maxSteps) {
      const seen = visits.get(node.id) ?? 0;
      if (seen >= 2 && node.kind !== 'loop') break; // a full second round has been shown
      visits.set(node.id, seen + 1);
      steps.push({ node, via });

      if (node.ref && depth === 0) {
        const lane = scene.lanes.find((l) => l.fn === node!.ref);
        const s = lane && startOf(lane.id);
        if (s) walk(s, depth + 1);
      }

      const edges: SceneEdge[] = out.get(node.id) ?? [];
      if (!edges.length) break;
      let pick = edges[0];
      if (edges.length > 1) {
        if (node.kind === 'switch') pick = edges[seen % edges.length];
        else {
          const wantYes = node.kind === 'loop' ? seen < 2 : seen % 2 === 0;
          pick = edges.find((e) => e.label === (wantYes ? 'yes' : 'no')) ?? edges.find((e) => e.kind !== 'back') ?? edges[0];
        }
      }
      via = pick;
      node = byId.get(pick.to);
    }
  }

  for (const id of wanted) {
    const s = startOf(id);
    if (s) walk(s, 0);
  }
  return steps;
}
