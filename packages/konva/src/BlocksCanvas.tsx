'use client';

// <BlocksCanvas/> — draws a Scene with react-konva. The Stage is driven imperatively for pan/zoom
// (React never re-renders on a drag), while selection/run state flows in as props and only repaints
// the shapes that changed.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import Konva from 'konva';
import { Layer, Shape, Stage } from 'react-konva';
import type { Scene } from '@codeblocks/core';
import { BlockNode, EdgeLabel, EdgeShape, LanePanel, RegionShape } from './shapes.tsx';
import { centerOn, fitView, isOutside, MAX_ZOOM, MIN_ZOOM, zoomAt } from './viewport.ts';
import type { Size, View } from './viewport.ts';
import { defaultTheme } from './theme.ts';
import type { BlocksTheme } from './theme.ts';
import { loadThemeFonts } from './metrics.ts';
import { navigate } from './nav.ts';

export interface BlocksCanvasProps {
  scene: Scene | null;
  selectedId?: string | null;
  runningId?: string | null;
  runningEdgeId?: string | null;
  theme?: BlocksTheme;
  /** A block was clicked (or Enter pressed on the keyboard-focused block). `null` = background click. */
  onSelect?: (id: string | null, info: { reveal: boolean }) => void;
  /** Pan to the block being highlighted by the guided run. Default true. */
  followRunning?: boolean;
  /** Pan so a block selected from the editor is visible. Default true. */
  revealSelected?: boolean;
  /** Pixels at the top reserved for floating toolbars when fitting the view. */
  topInset?: number;
  /** Fade the picture while an analysis is running or after a failure. */
  stale?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export interface BlocksCanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  centerOnNode(id: string): void;
  focusLane(id: string): void;
  /** Whole scene as a PNG data URL (not just the visible part). */
  toDataURL(opts?: { pixelRatio?: number; background?: string }): string | null;
  getView(): View;
  /** Screen-space rectangle of a block (for tests, tours and screen-reader focus rings). */
  getNodeScreenRect(id: string): { x: number; y: number; w: number; h: number } | null;
}

const SHADOW_LIMIT = 300;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const BlocksCanvas = forwardRef<BlocksCanvasHandle, BlocksCanvasProps>(function BlocksCanvas(
  {
    scene, selectedId = null, runningId = null, runningEdgeId = null, theme = defaultTheme, onSelect, followRunning = true, revealSelected = true,
    topInset = 0, stale = false, ariaLabel = 'Block view of your code', className, style,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const tweenRef = useRef<Konva.Tween | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const userMoved = useRef(false);
  const sizeRef = useRef<Size>({ w: 0, h: 0 });
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  const sceneRef = useRef<Scene | null>(scene);
  sceneRef.current = scene;

  const shadows = theme.shadows && (scene?.nodes.length ?? 0) <= SHADOW_LIMIT;

  // ---- size ---------------------------------------------------------------------------------
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.floor(r.width), h: Math.floor(r.height) };
      if (next.w !== sizeRef.current.w || next.h !== sizeRef.current.h) { sizeRef.current = next; setSize(next); }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- fonts: canvas text is only correct once the real font has loaded -----------------------
  useEffect(() => {
    let alive = true;
    void loadThemeFonts(theme).then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, [theme]);
  useEffect(() => { if (fontsReady) stageRef.current?.batchDraw(); }, [fontsReady]);

  // ---- viewport -----------------------------------------------------------------------------
  const readView = useCallback((): View => {
    const st = stageRef.current;
    return st ? { x: st.x(), y: st.y(), k: st.scaleX() } : viewRef.current;
  }, []);

  const apply = useCallback((v: View, animate = false) => {
    const st = stageRef.current;
    viewRef.current = v;
    if (!st) return;
    tweenRef.current?.destroy();
    tweenRef.current = null;
    if (animate && !prefersReducedMotion()) {
      const tw = new Konva.Tween({ node: st, duration: 0.55, x: v.x, y: v.y, scaleX: v.k, scaleY: v.k, easing: Konva.Easings.EaseInOut });
      tweenRef.current = tw;
      tw.play();
    } else {
      st.position({ x: v.x, y: v.y });
      st.scale({ x: v.k, y: v.k });
      st.batchDraw();
    }
  }, []);

  const fit = useCallback((readable: boolean) => {
    const sc = sceneRef.current;
    const sz = sizeRef.current;
    if (!sc || sz.w === 0) return;
    apply(fitView(sc.bounds, sz, { readable, top: topInset }));
  }, [apply, topInset]);

  // first paint / scene changes / resizes keep the view unless the user has taken control of it
  const firstFit = useRef(true);
  useEffect(() => {
    if (!scene || size.w === 0) return;
    if (firstFit.current || !userMoved.current) { fit(true); firstFit.current = false; }
  }, [scene, size, fit]);

  const centerNode = useCallback((id: string, animate = true, k?: number) => {
    const n = sceneRef.current?.nodes.find((x) => x.id === id);
    if (!n) return;
    const cur = readView();
    apply(centerOn(n.x, n.y + n.h / 2, sizeRef.current, k ?? Math.min(1, Math.max(cur.k, 0.75)), { x: 0.5, y: 0.42 }), animate);
    userMoved.current = true;
  }, [apply, readView]);

  // follow the guided run / reveal a block selected from the editor
  useEffect(() => {
    if (runningId && followRunning) centerNode(runningId);
  }, [runningId, followRunning, centerNode]);

  useEffect(() => {
    if (!selectedId || runningId || !revealSelected) return;
    const n = sceneRef.current?.nodes.find((x) => x.id === selectedId);
    if (n && isOutside(readView(), { x: n.x - n.w / 2, y: n.y, w: n.w, h: n.h }, sizeRef.current)) centerNode(selectedId);
  }, [selectedId, runningId, revealSelected, centerNode, readView]);

  // ---- imperative API -----------------------------------------------------------------------
  useImperativeHandle(ref, () => ({
    fit: () => { userMoved.current = false; fit(false); },
    zoomBy: (f) => {
      const sz = sizeRef.current;
      apply(zoomAt(readView(), f, sz.w / 2, sz.h / 2));
      userMoved.current = true;
    },
    centerOnNode: (id) => centerNode(id),
    focusLane: (id) => {
      const l = sceneRef.current?.lanes.find((x) => x.id === id);
      if (!l) return;
      const cur = readView();
      apply(centerOn(l.x + l.w / 2, l.y + Math.min(l.h / 2, 300 / cur.k + 80), sizeRef.current, cur.k), true);
      userMoved.current = true;
    },
    toDataURL: ({ pixelRatio = 2, background = '#F2F5FB' } = {}) => {
      const st = stageRef.current;
      const sc = sceneRef.current;
      if (!st || !sc) return null;
      const pad = 48;
      const saved = { w: st.width(), h: st.height(), x: st.x(), y: st.y(), sx: st.scaleX(), sy: st.scaleY() };
      const layer = st.getLayers()[0];
      const bg = new Konva.Rect({ x: -pad, y: -pad, width: sc.bounds.w + pad * 2, height: sc.bounds.h + pad * 2, fill: background, listening: false });
      layer.add(bg);
      bg.moveToBottom();
      st.size({ width: sc.bounds.w + pad * 2, height: sc.bounds.h + pad * 2 });
      st.position({ x: pad, y: pad });
      st.scale({ x: 1, y: 1 });
      try {
        return st.toDataURL({ pixelRatio, mimeType: 'image/png' });
      } finally {
        bg.destroy();
        st.size({ width: saved.w, height: saved.h });
        st.position({ x: saved.x, y: saved.y });
        st.scale({ x: saved.sx, y: saved.sy });
        st.batchDraw();
      }
    },
    getView: readView,
    getNodeScreenRect: (id) => {
      const n = sceneRef.current?.nodes.find((x) => x.id === id);
      if (!n) return null;
      const v = readView();
      const r = hostRef.current?.getBoundingClientRect();
      return { x: (n.x - n.w / 2) * v.k + v.x + (r?.left ?? 0), y: n.y * v.k + v.y + (r?.top ?? 0), w: n.w * v.k, h: n.h * v.k };
    },
  }), [apply, centerNode, fit, readView]);

  // ---- input --------------------------------------------------------------------------------
  const pinch = useRef<{ dist: number } | null>(null);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const st = stageRef.current;
    if (!st) return;
    tweenRef.current?.destroy();
    const v = readView();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const p = st.getPointerPosition() ?? { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 };
      apply(zoomAt(v, Math.exp(-e.evt.deltaY * 0.01), p.x, p.y));
    } else {
      apply({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY });
    }
    userMoved.current = true;
  }, [apply, readView]);

  const onTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const st = stageRef.current;
    const [t1, t2] = [e.evt.touches[0], e.evt.touches[1]];
    if (!st || !t1 || !t2) return;
    e.evt.preventDefault();
    if (st.isDragging()) st.stopDrag();
    const r = st.container().getBoundingClientRect();
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const cx = (t1.clientX + t2.clientX) / 2 - r.left;
    const cy = (t1.clientY + t2.clientY) / 2 - r.top;
    if (pinch.current) apply(zoomAt(readView(), dist / pinch.current.dist, cx, cy));
    pinch.current = { dist };
    userMoved.current = true;
  }, [apply, readView]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const sc = sceneRef.current;
    if (!sc) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home') {
      const id = navigate(sc, selectedId, e.key);
      if (id && onSelect) { e.preventDefault(); onSelect(id, { reveal: true }); }
    } else if (e.key === 'Enter' && selectedId && onSelect) {
      e.preventDefault();
      onSelect(selectedId, { reveal: true });
    } else if (e.key === 'Escape') {
      onSelect?.(null, { reveal: false });
    } else if (e.key === '+' || e.key === '=') {
      apply(zoomAt(readView(), 1.2, sizeRef.current.w / 2, sizeRef.current.h / 2));
    } else if (e.key === '-') {
      apply(zoomAt(readView(), 1 / 1.2, sizeRef.current.w / 2, sizeRef.current.h / 2));
    } else if (e.key === '0') {
      userMoved.current = false;
      fit(false);
    }
  }, [apply, fit, onSelect, readView, selectedId]);

  const select = useCallback((id: string) => onSelect?.(id, { reveal: true }), [onSelect]);

  // ---- derived ------------------------------------------------------------------------------
  const link = useMemo(() => (selectedId && scene ? scene.links.find((l) => l.from === selectedId) ?? null : null), [selectedId, scene]);
  const linkLane = link && scene ? scene.lanes.find((l) => l.id === link.toLane) : undefined;
  const from = link && scene ? scene.nodes.find((n) => n.id === link.from) : undefined;
  const hostStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none', outline: 'none', opacity: stale ? 0.55 : 1, transition: 'opacity .15s', ...style };

  return (
    <div
      ref={hostRef}
      className={className}
      style={hostStyle}
      tabIndex={0}
      role="application"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      data-testid="blocks-canvas"
      data-selected={selectedId ?? ''}
      data-running={runningId ?? ''}
      data-nodes={scene?.nodes.length ?? 0}
    >
      {size.w > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          draggable
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={() => { pinch.current = null; }}
          onDragStart={() => { tweenRef.current?.destroy(); userMoved.current = true; }}
          onDragEnd={() => { viewRef.current = readView(); }}
          onClick={(e) => { if (e.target === e.target.getStage()) onSelect?.(null, { reveal: false }); }}
          onTap={(e) => { if (e.target === e.target.getStage()) onSelect?.(null, { reveal: false }); }}
        >
          {/* backdrop: lanes + loop regions (no hit testing) */}
          <Layer listening={false}>
            {scene?.lanes.map((l) => <LanePanel key={l.id} lane={l} theme={theme} highlighted={linkLane?.id === l.id} />)}
            {scene?.regions.map((r, i) => <RegionShape key={i} region={r} theme={theme} />)}
          </Layer>
          <Layer listening={false}>
            {scene?.edges.map((e) => (
              <EdgeShape key={e.id} edge={e} theme={theme} running={runningEdgeId === e.id} highlighted={!!selectedId && (e.from === selectedId || e.to === selectedId)} />
            ))}
            {scene?.edges.map((e) => <EdgeLabel key={`l${e.id}`} edge={e} theme={theme} />)}
            {from && linkLane && (
              <Shape
                listening={false} stroke={theme.link} strokeWidth={3} dash={[3, 8]} lineCap="round"
                sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
                  const x1 = from.x + from.w / 2;
                  const y1 = from.y + from.h / 2;
                  const x2 = linkLane.x;
                  const y2 = linkLane.y + 40;
                  ctx.beginPath();
                  ctx.moveTo(x1, y1);
                  ctx.bezierCurveTo(x1 + 120, y1, x2 - 120, y2, x2, y2);
                  ctx.strokeShape(shape);
                }}
              />
            )}
          </Layer>
          <Layer>
            {scene?.nodes.map((n) => (
              <BlockNode key={n.id} node={n} theme={theme} shadows={shadows} selected={selectedId === n.id} running={runningId === n.id} onSelect={select} />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
});

export { MAX_ZOOM, MIN_ZOOM };
