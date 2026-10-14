// Read-only questions about a Scene, shared by the editor binding, the guided run and agent tools.

import type { Scene, SceneNode } from '../types.ts';

/** Smallest block whose source range contains `file:line`. */
export function findNodeAt(scene: Scene, file: string, line: number): SceneNode | null {
  let best: SceneNode | null = null;
  let bestSpan = Infinity;
  for (const n of scene.nodes) {
    const s = n.src;
    if (!s || s.file !== file || line < s.start || line > s.end) continue;
    const span = s.end - s.start;
    if (span < bestSpan) { best = n; bestSpan = span; }
  }
  return best;
}
