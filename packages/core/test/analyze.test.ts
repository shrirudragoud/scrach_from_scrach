import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, walkStmts, AnalyzeError } from '../src/index.ts';
import type { AnalyzeResult, Func } from '../src/index.ts';
import { configureNode } from './setup.ts';
import { SAMPLES } from './fixtures/samples.ts';

beforeAll(configureNode);

const kinds = (fn: Func): string[] => {
  const k: string[] = [];
  walkStmts(fn.body, (s) => k.push(s.t === 'action' ? s.kind : s.t));
  return k;
};
const fn = (r: AnalyzeResult, name: string): Func => r.program.functions.find((f) => f.name === name) as Func;
const titles = (r: AnalyzeResult): string[] => r.scene.nodes.map((n) => n.titleLines.join(' '));

describe('translation', () => {
  it('Blink: roles and node kinds', async () => {
    const r = await analyze(SAMPLES.Blink);
    expect(fn(r, 'setup').role).toBe('setup');
    expect(fn(r, 'loop').role).toBe('loop');
    expect(kinds(fn(r, 'loop'))).toEqual(['output', 'wait', 'output', 'wait']);
  });

  it('kids mode speaks plain English; code mode stays technical', async () => {
    const kid = titles(await analyze(SAMPLES.Blink));
    expect(kid).toContain('Turn ON LED (pin 13)');
    expect(kid).toContain('Turn OFF LED (pin 13)');
    expect(kid).toContain('Wait 1 second');
    const code = titles(await analyze(SAMPLES.Blink, { mode: 'code' }));
    expect(code).toContain('Set LED_PIN (13) HIGH');
    expect(code).toContain('Wait 1000 ms');
  });

  it('kids mode shows the real code under each block, with an explanation', async () => {
    const r = await analyze(SAMPLES.Blink);
    const n = r.scene.nodes.find((x) => x.titleLines[0].startsWith('Turn ON'));
    expect(n?.code).toBe('digitalWrite(LED_PIN, HIGH)');
    expect(n?.explain.length).toBeGreaterThan(20);
    const hidden = await analyze(SAMPLES.Blink, { showCode: false });
    expect(hidden.scene.nodes.find((x) => x.titleLines[0].startsWith('Turn ON'))?.code).toBeNull();
  });

  it('conditions are translated to words', async () => {
    const r = await analyze(SAMPLES['Button + LED']);
    expect(r.scene.nodes.find((n) => n.kind === 'decision')?.titleLines.join(' ')).toBe('reading is OFF and lastState is ON?');
    const pin = await analyze('const int btn = 2; void loop(){ if (digitalRead(btn) == HIGH) { delay(5); } }');
    expect(pin.scene.nodes.find((n) => n.kind === 'decision')?.titleLines.join(' ')).toBe('button (pin 2) is ON?');
  });

  it('counting for-loops become "Repeat N times" and hide the counter plumbing', async () => {
    const src = 'void loop(){ for (int i = 0; i < 3; i++) { digitalWrite(13, HIGH); } }';
    const kid = await analyze(src);
    expect(titles(kid)).toContain('Repeat 3 times');
    expect(kid.scene.nodes.some((n) => /i\+\+|Add 1 to i|int i = 0/.test(n.titleLines.join(' ')))).toBe(false);
    const code = await analyze(src, { mode: 'code' });
    expect(code.scene.nodes.some((n) => n.titleLines.join(' ') === 'i++')).toBe(true);
  });

  it('attachInterrupt marks the handler as an ISR and links to its lane', async () => {
    const r = await analyze(SAMPLES['Parking sensor']);
    expect(fn(r, 'onReset').role).toBe('isr');
    expect(r.scene.links.some((l) => l.toLane === 'fn:onReset' && l.kind === 'trigger')).toBe(true);
    expect(fn(r, 'readDistanceCm').role).toBe('user');
    expect(fn(r, 'readDistanceCm').calledBy).toEqual(['loop', 'loop']);
  });

  it('consecutive pinMode calls collapse into one card', async () => {
    const code = (await analyze(SAMPLES['Parking sensor'], { mode: 'code' })).scene.nodes.find((n) => n.kind === 'pin-config');
    expect(code?.lines).toHaveLength(6);
    expect(code?.lines[0]).toContain('TRIG (7) → OUTPUT');
    const kid = (await analyze(SAMPLES['Parking sensor'])).scene.nodes.find((n) => n.kind === 'pin-config');
    expect(kid?.titleLines.join(' ')).toBe('Get the pins ready');
    expect(kid?.lines[0]).toBe('Trigger (pin 7) sends out');
  });

  it('switch: shared case labels and trailing breaks', async () => {
    const r = await analyze(SAMPLES['Parking sensor']);
    const sw = fn(r, 'loop').body.find((s) => s.t === 'switch');
    expect(sw && sw.t === 'switch' && sw.cases.map((c) => c.labels)).toEqual([['0'], ['1', '2'], ['default']]);
    expect(r.scene.edges.map((e) => e.label)).toContain('is 1 or 2');
    const code = await analyze(SAMPLES['Parking sensor'], { mode: 'code' });
    expect(code.scene.edges.map((e) => e.label)).toContain('1, 2');
  });

  it('ISR lint: delay/Serial inside an interrupt handler are flagged', async () => {
    const r = await analyze('void tick(){ delay(5); Serial.println(1); }\nvoid setup(){ attachInterrupt(0, tick, RISING); }\nvoid loop(){}');
    expect(r.scene.nodes.filter((n) => n.warn)).toHaveLength(2);
  });

  it('library objects are labelled by their declared type', async () => {
    const r = await analyze(SAMPLES['Servo sweep']);
    expect(r.scene.nodes.find((x) => x.titleLines[0] === 'Turn the servo to pos°')?.category).toBe('SERVO');
  });

  it('#ifdef: only the primary branch is drawn and tagged', async () => {
    const r = await analyze('void loop(){\n#ifdef DEBUG\n Serial.println(1);\n#else\n foo();\n#endif\n bar(); }');
    const cards = r.scene.nodes.filter((n) => n.shape === 'card');
    expect(cards).toHaveLength(2);
    expect(cards[0].subLines[0]).toBe('#ifdef DEBUG');
  });
});

describe('robustness', () => {
  it('syntax errors are reported with line numbers but the rest still renders', async () => {
    const r = await analyze('void setup(){ pinMode(2, OUTPUT); }\nvoid loop(){ digitalWrite(2, HIGH\n delay(5); }');
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics[0].line).toBeGreaterThanOrEqual(2);
    expect(r.scene.nodes.some((n) => n.kind === 'pin-config')).toBe(true);
  });

  it('does not report a legal stray semicolon after an in-class method as an error', async () => {
    const src = 'class P {\n public:\n  P(int a) : v(a) {\n    (void)a;\n  };\n  int v;\n};\nvoid setup(){}\nvoid loop(){}';
    expect((await analyze(src)).diagnostics).toEqual([]);
  });

  it('refuses oversized sources with a typed error', async () => {
    await expect(analyze('//'.padEnd(500, 'x'), { limits: { maxSourceChars: 100 } })).rejects.toMatchObject({ code: 'too-large' });
  });

  it('refuses programs with too many blocks instead of freezing', async () => {
    const big = `void loop(){${'digitalWrite(13, HIGH); delay(1);'.repeat(80)}}`;
    await expect(analyze(big, { limits: { maxNodes: 50 } })).rejects.toBeInstanceOf(AnalyzeError);
  });

  it('rejects unknown languages clearly', async () => {
    await expect(analyze('x', { language: 'cobol' })).rejects.toMatchObject({ code: 'unsupported-language' });
  });

  it('empty and comment-only sources give an empty scene, not an error', async () => {
    const r = await analyze('// nothing here\n');
    expect(r.scene.nodes).toHaveLength(0);
    expect(r.scene.bounds).toEqual({ w: 0, h: 0 });
  });
});

describe('text metrics', () => {
  it('wider glyphs wrap earlier (renderer-calibrated layout)', async () => {
    const src = 'void loop(){ Serial.println("a fairly long message that must wrap somewhere"); }';
    const narrow = await analyze(src, { metrics: { title: 6 } });
    const wide = await analyze(src, { metrics: { title: 11 } });
    const lines = (r: AnalyzeResult) => r.scene.nodes.find((n) => n.kind === 'serial')!.titleLines.length;
    expect(lines(wide)).toBeGreaterThan(lines(narrow));
  });
});
