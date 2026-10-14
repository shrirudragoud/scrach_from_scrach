// Visual theme. Everything a school might want to re-brand lives here; the engine knows nothing of colours.
// Palette follows Scratch's category colours so kids can transfer what they already know.

import type { LaneRole, NodeKind } from '@codeblocks/core';

export interface KindStyle { color: string; ink: string }
export interface LaneStyle { label: string; color: string }

export interface BlocksTheme {
  fonts: { ui: string; mono: string; emoji: string };
  kinds: Record<NodeKind, KindStyle>;
  lanes: Record<LaneRole, LaneStyle>;
  edge: { plain: string; yes: string; no: string; back: string; width: number };
  panel: { fill: string; stroke: string };
  region: { fill: string; stroke: string };
  text: { lane: string; laneSub: string };
  selection: string;
  runGlow: string;
  warn: string;
  link: string;
  /** Soft drop shadows (auto-disabled on very large scenes). */
  shadows: boolean;
}

export const defaultTheme: BlocksTheme = {
  fonts: {
    ui: "Nunito, 'Baloo 2', ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace",
    emoji: "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif",
  },
  kinds: {
    start: { color: '#FFBF00', ink: '#4A3500' },
    end: { color: '#8A94A6', ink: '#fff' },
    decision: { color: '#FFAB19', ink: '#4A2F00' },
    loop: { color: '#FF8C1A', ink: '#4A2600' },
    switch: { color: '#FFAB19', ink: '#4A2F00' },
    return: { color: '#8A94A6', ink: '#fff' },
    break: { color: '#FF6B6B', ink: '#fff' },
    continue: { color: '#FFAB19', ink: '#4A2F00' },
    'pin-config': { color: '#0FBD8C', ink: '#fff' },
    output: { color: '#9966FF', ink: '#fff' },
    input: { color: '#2DB4D8', ink: '#fff' },
    wait: { color: '#FFAB19', ink: '#4A2F00' },
    serial: { color: '#CF63CF', ink: '#fff' },
    bus: { color: '#0FBD8C', ink: '#fff' },
    call: { color: '#FF6680', ink: '#fff' },
    trigger: { color: '#F5B700', ink: '#4A3500' },
    callback: { color: '#F5B700', ink: '#4A3500' },
    library: { color: '#4C97FF', ink: '#fff' },
    declare: { color: '#FF8C1A', ink: '#4A2600' },
    process: { color: '#59C059', ink: '#fff' },
    globals: { color: '#6B7A99', ink: '#fff' },
  },
  lanes: {
    setup: { label: 'RUNS ONCE', color: '#1FB58F' },
    loop: { label: 'REPEATS FOREVER', color: '#7C5CFF' },
    isr: { label: 'DOORBELL', color: '#F5B700' },
    callback: { label: 'CALLBACK', color: '#F5B700' },
    user: { label: 'MY BLOCK', color: '#FF6680' },
    globals: { label: 'NAMES', color: '#6B7A99' },
  },
  edge: { plain: '#98A5BA', yes: '#2FBF71', no: '#FF7070', back: '#9B7CFF', width: 2.6 },
  panel: { fill: 'rgba(255,255,255,0.78)', stroke: '#E1E7F0' },
  region: { fill: 'rgba(255,140,26,0.07)', stroke: 'rgba(255,140,26,0.4)' },
  text: { lane: '#25324D', laneSub: '#7A879C' },
  selection: '#25324D',
  runGlow: 'rgba(31,181,143,0.95)',
  warn: '#E5483D',
  link: '#F59E0B',
  shadows: true,
};

/** Darken a #rrggbb colour by `amt` (0..1) — used for the 3-D lip under each block. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 - amt))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}
