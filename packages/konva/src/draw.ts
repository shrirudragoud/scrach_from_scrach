// Pure path helpers over a minimal canvas-context interface (so they are testable without a canvas).

export interface PathCtx {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
}

export type Pt = [number, number];

/** Polyline with rounded corners (quadratic curves through each bend). */
export function roundedPolyline(ctx: PathCtx, pts: Pt[], r = 12): void {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    ctx.lineTo(cx - ((cx - px) / l1) * rr, cy - ((cy - py) / l1) * rr);
    ctx.quadraticCurveTo(cx, cy, cx + ((nx - cx) / l2) * rr, cy + ((ny - cy) / l2) * rr);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

/** Elongated hexagon with pointed left/right ends (the "question" block). Origin = top-left. */
export function hexPath(ctx: PathCtx, w: number, h: number, dy = 0, slant = 28): void {
  const cy = h / 2 + dy;
  ctx.moveTo(0, cy);
  ctx.lineTo(slant, dy);
  ctx.lineTo(w - slant, dy);
  ctx.lineTo(w, cy);
  ctx.lineTo(w - slant, h + dy);
  ctx.lineTo(slant, h + dy);
  ctx.closePath();
}

/** The little bump on top of a hat block (start of a script). Origin = block top-left. */
export function hatBumpPath(ctx: PathCtx, dy = 0): void {
  ctx.moveTo(18, 8 + dy);
  ctx.bezierCurveTo(34, -18 + dy, 100, -18 + dy, 126, 8 + dy);
  ctx.closePath();
}

/** Triangle arrow head whose tip is at `to`, pointing away from `from`. */
export function arrowHead(ctx: PathCtx, from: Pt, to: Pt, size = 9): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to[0] - ux * size;
  const by = to[1] - uy * size;
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(bx - uy * (size * 0.55), by + ux * (size * 0.55));
  ctx.lineTo(bx + uy * (size * 0.55), by - ux * (size * 0.55));
  ctx.closePath();
}
