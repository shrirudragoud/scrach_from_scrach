// Layout-internal shapes (not part of the public Scene contract).
import type { Point, SceneNode } from '../types.ts';

export type Port = 'top' | 'bottom' | 'left' | 'right';

export interface LEdge {
  id: string;
  from: string;
  to: string;
  kind: 'flow' | 'branch' | 'back';
  fromPort?: Port;
  label: string;
  tone: 'yes' | 'no' | null;
  /** x of the vertical lane a loop/exit edge runs along (relative until the lane is placed). */
  laneX?: number;
  /** lane x of the *source* when a back edge starts at a nested loop's left exit. */
  srcLaneX?: number;
  /** y of the horizontal bus a back edge drops to below its body. */
  busY?: number;
  points: Point[];
  labelAt: Point | null;
}

export type LNode = SceneNode;
