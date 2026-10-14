import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '@codeblocks/core';
import type { Scene } from '@codeblocks/core';
import Parser from 'web-tree-sitter';
import { configure } from '@codeblocks/core';
import { createRequire } from 'node:module';
import path from 'node:path';
import { navigate } from '../src/nav.ts';

let scene: Scene;
const titleOf = (id: string | null) => scene.nodes.find((n) => n.id === id)?.titleLines.join(' ');

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const dir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  configure({ Parser: Parser as never, grammars: { cpp: path.join(dir, 'tree-sitter-cpp.wasm') } });
  scene = (await analyze('#define LED 13\nvoid helper() { delay(5); }\nvoid setup() { pinMode(LED, OUTPUT); }\nvoid loop() { digitalWrite(LED, HIGH); helper(); }')).scene;
});

describe('keyboard navigation', () => {
  it('starts at the first function, not at the names card (which has no outgoing arrow)', () => {
    expect(titleOf(navigate(scene, null, 'ArrowDown'))).toBe('When the board starts');
    expect(titleOf(navigate(scene, null, 'Home'))).toBe('When the board starts');
  });

  it('walks the flow down and back up', () => {
    const seen: string[] = [];
    let id = navigate(scene, null, 'Home');
    let last = id;
    while (id && seen.length < 10) { seen.push(titleOf(id) as string); last = id; id = navigate(scene, id, 'ArrowDown'); }
    expect(seen).toEqual(['When the board starts', 'LED (pin 13) sends signals out', 'Now go to loop()']);
    expect(titleOf(navigate(scene, last, 'ArrowUp'))).toBe('LED (pin 13) sends signals out');
  });

  it('stops at the end of a lane instead of wandering off', () => {
    const end = scene.nodes.find((n) => n.kind === 'end')!;
    expect(navigate(scene, end.id, 'ArrowDown')).toBeNull();
  });

  it('left/right hop between function lanes and finally reach the names card', () => {
    let id = navigate(scene, null, 'Home');
    const lanes: string[] = [];
    for (let i = 0; i < 6 && id; i++) { lanes.push(scene.nodes.find((n) => n.id === id)?.lane as string); id = navigate(scene, id, 'ArrowRight'); }
    expect(lanes).toEqual(['fn:setup', 'fn:loop', 'fn:helper', 'globals']);
    expect(navigate(scene, scene.nodes.find((n) => n.lane === 'globals')!.id, 'ArrowRight')).toBeNull();
  });
});
