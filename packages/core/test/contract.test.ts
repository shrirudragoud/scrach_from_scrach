// The Scene is the public contract between the engine and any renderer (ours, or a host's native one).
// These tests pin its shape. If one fails, you are changing the contract: bump SCENE_VERSION and
// document the change in INTEGRATION.md before updating the expectation.

import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject, SCENE_VERSION } from '../src/index.ts';
import type { Scene } from '../src/index.ts';
import { validateScene } from '../src/validate.ts';
import { configureNode } from './setup.ts';

beforeAll(configureNode);

const SRC = `const int led = 13;
void flash(int n) {
  for (int i = 0; i < n; i++) {
    digitalWrite(led, HIGH);
    delay(100);
  }
}
void setup() { pinMode(led, OUTPUT); }
void loop() {
  if (digitalRead(2) == HIGH) { flash(3); } else { digitalWrite(led, LOW); }
  delay(50);
}
`;

const keys = (o: object) => Object.keys(o).sort();

describe('Scene contract', () => {
  let scene: Scene;
  beforeAll(async () => { scene = (await analyzeProject([{ name: 'a.ino', content: SRC }])).scene; });

  it('has a pinned version', () => {
    expect(SCENE_VERSION).toBe(3);
    expect(scene.version).toBe(SCENE_VERSION);
  });

  it('top level keys', () => {
    expect(keys(scene)).toEqual(['bounds', 'edges', 'lanes', 'language', 'links', 'mode', 'nodes', 'regions', 'version']);
  });

  it('every node carries the documented fields (optional ones may be absent)', () => {
    const required = ['category', 'code', 'emoji', 'explain', 'h', 'id', 'kind', 'lines', 'ref', 'shape', 'subLines', 'titleLines', 'w', 'x', 'y'];
    const optional = new Set(['error', 'lane', 'loc', 'src', 'text', 'warn']);
    for (const n of scene.nodes) {
      const k = keys(n);
      for (const r of required) expect(k, `node ${n.id} has ${r}`).toContain(r);
      for (const extra of k.filter((x) => !required.includes(x))) expect(optional.has(extra), `unexpected node field ${extra}`).toBe(true);
    }
  });

  it('edges and lanes', () => {
    for (const e of scene.edges) expect(keys(e)).toEqual(['from', 'id', 'kind', 'label', 'labelAt', 'points', 'to', 'tone']);
    for (const l of scene.lanes) for (const r of ['h', 'id', 'name', 'role', 'w', 'x', 'y']) expect(keys(l)).toContain(r);
    expect(new Set(scene.edges.map((e) => e.kind))).toEqual(new Set(['flow', 'branch', 'back']));
  });

  it('is plain JSON: survives a JSON round trip unchanged, with finite geometry', () => {
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
    for (const n of scene.nodes) for (const v of [n.x, n.y, n.w, n.h]) expect(Number.isFinite(v)).toBe(true);
    for (const e of scene.edges) for (const [x, y] of e.points) expect(Number.isFinite(x + y)).toBe(true);
  });

  it('satisfies its own structural invariants', () => {
    expect(validateScene(scene)).toEqual([]);
  });

  it('source locations point into the user file (1-based, inclusive)', () => {
    const lines = SRC.split('\n').length;
    for (const n of scene.nodes) {
      if (!n.src) continue;
      expect(n.src.file).toBe('a.ino');
      expect(n.src.start).toBeGreaterThanOrEqual(1);
      expect(n.src.end).toBeGreaterThanOrEqual(n.src.start);
      expect(n.src.end).toBeLessThanOrEqual(lines);
    }
  });
});
