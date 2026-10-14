import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Selector lists of every rule (at-rule bodies are flattened by matching `selector {` pairs).
const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => s && !s.startsWith('@'));

describe('panel stylesheet does not leak into the host', () => {
  it('has rules', () => {
    expect(selectors.length).toBeGreaterThan(20);
  });

  it('every selector is rooted in a .cb- or .codeblocks- class', () => {
    for (const list of selectors) {
      for (const sel of list.split(',').map((s) => s.trim())) {
        expect(sel, `selector "${sel}"`).toMatch(/^(?::where\()?\.(cb|codeblocks)-/);
      }
    }
  });

  it('never targets :root, html or body', () => {
    expect(css).not.toMatch(/(^|[\s,}])(:root|html|body)\b/);
  });

  it('declares the documented variables with zero-specificity defaults', () => {
    const block = css.match(/:where\(\.cb-panel\)\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const v of ['ink', 'muted', 'card', 'green', 'dark', 'bg', 'danger', 'radius', 'font', 'mono']) expect(block).toContain(`--cb-${v}:`);
  });
});
