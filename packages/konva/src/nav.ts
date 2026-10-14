// Keyboard navigation over a Scene (pure, so it is unit-testable and reusable by screen-reader UIs).
//   ↓ / ↑   follow the flow to the next / previous block
//   → / ←   jump to the next / previous function lane (its first block)
//   Home    first block of the first function

import type { Scene, SceneNode } from '@codeblocks/core';

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home';

const firstOfLane = (scene: Scene, laneId: string): SceneNode | undefined =>
  scene.nodes.find((n) => n.lane === laneId && n.kind === 'start') ?? scene.nodes.find((n) => n.lane === laneId);

/** Lanes a keyboard user can visit: functions first (the "Names & tools" card is reachable but last). */
function laneOrder(scene: Scene): string[] {
  const fns = scene.lanes.filter((l) => l.role !== 'globals').map((l) => l.id);
  const globals = scene.lanes.filter((l) => l.role === 'globals').map((l) => l.id);
  return [...fns, ...globals];
}

export function navigate(scene: Scene, selectedId: string | null, key: NavKey): string | null {
  const order = laneOrder(scene);
  const cur = selectedId ? scene.nodes.find((n) => n.id === selectedId) : undefined;

  if (key === 'Home' || !cur) return order.length ? firstOfLane(scene, order[0])?.id ?? null : scene.nodes[0]?.id ?? null;

  if (key === 'ArrowDown') {
    const e = scene.edges.find((x) => x.from === cur.id && x.kind !== 'back') ?? scene.edges.find((x) => x.from === cur.id);
    return e?.to ?? null;
  }
  if (key === 'ArrowUp') {
    return scene.edges.find((x) => x.to === cur.id && x.kind !== 'back')?.from ?? null;
  }
  const i = order.indexOf(cur.lane ?? '');
  const target = order[i + (key === 'ArrowRight' ? 1 : -1)];
  return target ? firstOfLane(scene, target)?.id ?? null : null;
}
