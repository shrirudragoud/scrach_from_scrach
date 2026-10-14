import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject, combineFiles, locate, mapLoc, toCombinedLine, languageForFile, arduino } from '../src/index.ts';
import { validateScene } from '../src/validate.ts';
import { configureNode } from './setup.ts';

beforeAll(configureNode);

const files = [
  { name: 'helpers.ino', content: '#define LED 13\nvoid blinkTwice() {\n  digitalWrite(LED, HIGH);\n  delay(100);\n  digitalWrite(LED, LOW);\n}\n' },
  { name: 'trafficlight.ino', content: 'void setup() {\n  pinMode(LED, OUTPUT);\n}\n\nvoid loop() {\n  blinkTwice();\n  delay(500);\n}\n' },
  { name: 'notes.txt', content: 'not code' },
  { name: 'util.h', content: '// ignored' },
];

describe('combineFiles', () => {
  it('puts the main tab first, then the rest alphabetically, ignoring non-sketch files', () => {
    const c = combineFiles(files, arduino.extensions, 'trafficlight.ino');
    expect(c.segments.map((s) => s.file)).toEqual(['trafficlight.ino', 'helpers.ino']);
    expect(c.segments[0].start).toBe(1);
    expect(c.segments[1].start).toBe(c.segments[0].lines + 1);
  });

  it('round-trips lines between combined and per-file coordinates', () => {
    const c = combineFiles(files, arduino.extensions, 'trafficlight.ino');
    for (const [file, line] of [['trafficlight.ino', 6], ['helpers.ino', 2], ['helpers.ino', 1]] as const) {
      const combined = toCombinedLine(c.segments, file, line) as number;
      expect(locate(c.segments, combined)).toEqual({ file, line });
    }
    expect(mapLoc(c.segments, { start: 3, end: 99 })).toMatchObject({ file: 'trafficlight.ino', start: 3 });
  });
});

describe('analyzeProject', () => {
  it('draws blocks from every tab and points each one at its own file and line', async () => {
    const r = await analyzeProject(files, { main: 'trafficlight.ino', mode: 'code' });
    expect(validateScene(r.scene)).toEqual([]);
    expect(r.stats.files).toBe(2);

    const call = r.scene.nodes.find((n) => n.kind === 'call');
    expect(call?.src).toEqual({ file: 'trafficlight.ino', start: 6, end: 6 });
    const led = r.scene.nodes.find((n) => n.titleLines.join(' ') === 'Set LED (13) HIGH');
    expect(led?.src).toEqual({ file: 'helpers.ino', start: 3, end: 3 });

    const lane = r.scene.lanes.find((l) => l.fn === 'blinkTwice');
    expect(lane?.src?.file).toBe('helpers.ino');
  });

  it('maps syntax errors back to the right file and line', async () => {
    const broken = [
      { name: 'a.ino', content: 'void setup() {}\nvoid loop() { delay(5); }\n' },
      { name: 'b.ino', content: 'void helper() {\n  digitalWrite(2, HIGH\n}\n' },
    ];
    const r = await analyzeProject(broken, { main: 'a.ino' });
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics.every((d) => d.file === 'b.ino')).toBe(true);
    expect(r.diagnostics[0].line).toBeLessThanOrEqual(3);
  });

  it('is stable when tabs are supplied in a different order', async () => {
    const a = await analyzeProject(files, { main: 'trafficlight.ino' });
    const b = await analyzeProject([...files].reverse(), { main: 'trafficlight.ino' });
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
  });

  it('knows which file extensions belong to a language', () => {
    expect(languageForFile('Blink.INO')).toBe('arduino');
    expect(languageForFile('main.py')).toBeNull();
  });
});
