// Measure the real width of the theme's fonts so the layout engine wraps text exactly where this
// renderer will draw it (different machines substitute different fonts — Chromebooks, Linux, iPads).

import type { TextMetrics } from '@codeblocks/core';
import type { BlocksTheme } from './theme.ts';

const SAMPLE = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 (),.:+-=<>"\'';

export function measureTextMetrics(theme: BlocksTheme, ctx?: CanvasRenderingContext2D | null): TextMetrics | null {
  const c = ctx ?? (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null);
  if (!c) return null;
  const perChar = (font: string): number => {
    c.font = font;
    return c.measureText(SAMPLE).width / SAMPLE.length;
  };
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    title: round(perChar(`800 15px ${theme.fonts.ui}`)),
    small: round(perChar(`700 12px ${theme.fonts.ui}`)),
    mono: round(perChar(`600 11.5px ${theme.fonts.mono}`)),
  };
}

/** Wait for the theme's UI/mono fonts so canvas text is drawn (and measured) with the real glyphs. */
export async function loadThemeFonts(theme: BlocksTheme): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const first = (stack: string) => stack.split(',')[0].trim();
  try {
    await Promise.all([
      document.fonts.load(`800 15px ${first(theme.fonts.ui)}`),
      document.fonts.load(`700 12px ${first(theme.fonts.ui)}`),
      document.fonts.load(`600 11.5px ${first(theme.fonts.mono)}`),
    ]);
    await document.fonts.ready;
  } catch {
    /* fonts are an enhancement; fall back silently */
  }
}
