import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { validateScene } from '../src/validate.ts';
import { configureNode } from './setup.ts';
import { SAMPLES } from './fixtures/samples.ts';
import { SNIPPETS, TORTURE } from './fixtures/torture.ts';

beforeAll(configureNode);

const all: Record<string, string> = { ...SAMPLES, torture: TORTURE, ...SNIPPETS };

describe.each(['kids', 'code'] as const)('layout invariants [%s]', (mode) => {
  it.each(Object.entries(all))('%s', async (_name, src) => {
    const { scene } = await analyze(src, { mode });
    expect(validateScene(scene)).toEqual([]);
  });
});

it('is deterministic', async () => {
  const a = await analyze(TORTURE);
  const b = await analyze(TORTURE);
  expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
});

it('scene is plain JSON (survives structured clone / JSON round trip)', async () => {
  const { scene } = await analyze(SAMPLES['Parking sensor']);
  expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  expect(structuredClone(scene)).toEqual(scene);
});

it('does not leak layout-internal fields into the public scene', async () => {
  const { scene } = await analyze(TORTURE);
  for (const e of scene.edges) {
    expect(Object.keys(e).sort()).toEqual(['from', 'id', 'kind', 'label', 'labelAt', 'points', 'to', 'tone']);
  }
});
