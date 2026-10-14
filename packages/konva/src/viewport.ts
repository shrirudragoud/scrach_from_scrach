// Pure viewport maths (pan / zoom / fit / centre) — no Konva, easy to unit-test.

export interface View { x: number; y: number; k: number }
export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 2.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FitOptions {
  pad?: number;
  /** Space reserved at the top for floating toolbars. */
  top?: number;
  /** Never start below 0.55× on big scenes: anchor top-left and let the user pan. */
  readable?: boolean;
}

export function fitView(bounds: Size, size: Size, { pad = 40, top = 0, readable = false }: FitOptions = {}): View {
  const full = Math.min(1, (size.w - pad * 2) / Math.max(bounds.w, 1), (size.h - top - pad) / Math.max(bounds.h, 1));
  const k = clamp(readable ? Math.max(full, 0.55) : full, MIN_ZOOM, MAX_ZOOM);
  const overflowX = bounds.w * k > size.w - pad * 2;
  const overflowY = bounds.h * k > size.h - top - pad;
  return {
    k,
    x: overflowX ? pad : (size.w - bounds.w * k) / 2,
    y: overflowY ? top : Math.max(top, (size.h - bounds.h * k) / 2),
  };
}

/** Zoom by `factor` keeping the point under (cx, cy) fixed. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const f = k / view.k;
  return { k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
}

/** A view that puts scene point (px, py) at `anchor` (fractions of the viewport) at zoom k. */
export function centerOn(px: number, py: number, size: Size, k: number, anchor: { x: number; y: number } = { x: 0.5, y: 0.5 }): View {
  const kk = clamp(k, MIN_ZOOM, MAX_ZOOM);
  return { k: kk, x: size.w * anchor.x - px * kk, y: size.h * anchor.y - py * kk };
}

/** Is a scene-space rect (partly) outside the visible area, within `margin` px? */
export function isOutside(view: View, rect: Rect, size: Size, margin = 40): boolean {
  const left = rect.x * view.k + view.x;
  const top = rect.y * view.k + view.y;
  const right = (rect.x + rect.w) * view.k + view.x;
  const bottom = (rect.y + rect.h) * view.k + view.y;
  return left < margin || top < margin || right > size.w - margin || bottom > size.h - margin;
}

export function sceneToScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: x * view.k + view.x, y: y * view.k + view.y };
}
