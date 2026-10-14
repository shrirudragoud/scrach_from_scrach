import { describe, expect, it } from 'vitest';
import { centerOn, fitView, isOutside, MAX_ZOOM, MIN_ZOOM, sceneToScreen, zoomAt } from '../src/viewport.ts';

describe('fitView', () => {
  it('centres a small scene at 1×', () => {
    expect(fitView({ w: 400, h: 300 }, { w: 1000, h: 800 })).toEqual({ k: 1, x: 300, y: 250 });
  });

  it('shrinks a big scene to fit entirely', () => {
    const v = fitView({ w: 4000, h: 2000 }, { w: 1000, h: 800 }, { pad: 40 });
    expect(v.k).toBeCloseTo((1000 - 80) / 4000, 5);
    expect(v.k * 4000).toBeLessThanOrEqual(920 + 1e-6);
  });

  it('readable mode never starts below 0.55× and anchors top-left (with the toolbar inset)', () => {
    const v = fitView({ w: 4000, h: 3000 }, { w: 1000, h: 800 }, { readable: true, top: 100, pad: 40 });
    expect(v.k).toBe(0.55);
    expect(v).toMatchObject({ x: 40, y: 100 });
  });

  it('never goes outside the zoom limits', () => {
    expect(fitView({ w: 1e7, h: 1e7 }, { w: 100, h: 100 }).k).toBe(MIN_ZOOM);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const v0 = { x: 30, y: 50, k: 1 };
    const v1 = zoomAt(v0, 2, 200, 120);
    const before = { x: (200 - v0.x) / v0.k, y: (120 - v0.y) / v0.k };
    const after = { x: (200 - v1.x) / v1.k, y: (120 - v1.y) / v1.k };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps at the limits without drifting', () => {
    let v = { x: 0, y: 0, k: 1 };
    for (let i = 0; i < 50; i++) v = zoomAt(v, 2, 100, 100);
    expect(v.k).toBe(MAX_ZOOM);
    for (let i = 0; i < 50; i++) v = zoomAt(v, 0.5, 100, 100);
    expect(v.k).toBe(MIN_ZOOM);
  });
});

describe('centerOn / isOutside / sceneToScreen', () => {
  it('puts a scene point at the requested anchor', () => {
    const size = { w: 1000, h: 600 };
    const v = centerOn(500, 400, size, 1, { x: 0.5, y: 0.42 });
    expect(sceneToScreen(v, 500, 400)).toEqual({ x: 500, y: 252 });
  });

  it('detects blocks that are (partly) out of view', () => {
    const size = { w: 1000, h: 600 };
    const v = { x: 0, y: 0, k: 1 };
    expect(isOutside(v, { x: 100, y: 100, w: 200, h: 100 }, size)).toBe(false);
    expect(isOutside(v, { x: 900, y: 100, w: 200, h: 100 }, size)).toBe(true);
    expect(isOutside(v, { x: 100, y: 580, w: 200, h: 100 }, size)).toBe(true);
  });
});
