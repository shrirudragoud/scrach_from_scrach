import { describe, expect, it } from 'vitest';
import { arrowHead, hexPath, roundedPolyline } from '../src/draw.ts';
import type { PathCtx } from '../src/draw.ts';

function recorder() {
  const ops: [string, ...number[]][] = [];
  const ctx: PathCtx = {
    moveTo: (x, y) => ops.push(['M', x, y]),
    lineTo: (x, y) => ops.push(['L', x, y]),
    quadraticCurveTo: (a, b, x, y) => ops.push(['Q', a, b, x, y]),
    bezierCurveTo: (a, b, c, d, x, y) => ops.push(['C', a, b, c, d, x, y]),
    closePath: () => ops.push(['Z']),
  };
  return { ops, ctx };
}

describe('roundedPolyline', () => {
  it('passes through endpoints and rounds each bend with a quadratic curve at the corner', () => {
    const { ops, ctx } = recorder();
    roundedPolyline(ctx, [[0, 0], [0, 100], [100, 100]], 12);
    expect(ops[0]).toEqual(['M', 0, 0]);
    expect(ops[1]).toEqual(['L', 0, 88]);
    expect(ops[2]).toEqual(['Q', 0, 100, 12, 100]);
    expect(ops[3]).toEqual(['L', 100, 100]);
  });

  it('shrinks the radius on short segments instead of overshooting', () => {
    const { ops, ctx } = recorder();
    roundedPolyline(ctx, [[0, 0], [0, 10], [50, 10]], 12);
    expect(ops[1]).toEqual(['L', 0, 5]);
  });

  it('draws a straight segment when there is no bend, and nothing for a single point', () => {
    const a = recorder();
    roundedPolyline(a.ctx, [[0, 0], [0, 50]]);
    expect(a.ops).toEqual([['M', 0, 0], ['L', 0, 50]]);
    const b = recorder();
    roundedPolyline(b.ctx, [[0, 0]]);
    expect(b.ops).toEqual([]);
  });
});

describe('hexPath', () => {
  it('is a closed six-point shape with pointed ends at mid-height', () => {
    const { ops, ctx } = recorder();
    hexPath(ctx, 300, 70, 0, 28);
    expect(ops).toEqual([['M', 0, 35], ['L', 28, 0], ['L', 272, 0], ['L', 300, 35], ['L', 272, 70], ['L', 28, 70], ['Z']]);
  });
});

describe('arrowHead', () => {
  it('puts its tip exactly at the end point, whatever the direction', () => {
    for (const [from, to] of [[[0, 0], [0, 50]], [[50, 0], [0, 0]], [[0, 50], [0, 0]]] as const) {
      const { ops, ctx } = recorder();
      arrowHead(ctx, [...from], [...to], 10);
      expect(ops[0]).toEqual(['M', to[0], to[1]]);
      expect(ops).toHaveLength(4);
    }
  });
});
