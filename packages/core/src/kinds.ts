// Semantic vocabulary of a block: label, emoji and shape. Colours live in the renderer's theme
// (packages/konva), so a school can re-brand without touching the engine.

import type { NodeKind, NodeShape } from './types.ts';

export interface KindMeta {
  label: string;
  emoji: string;
  shape: NodeShape;
}

export const KINDS: Record<NodeKind, KindMeta> = {
  start: { label: 'Start', emoji: '🏁', shape: 'hat' },
  end: { label: 'Done', emoji: '🏁', shape: 'pill' },
  decision: { label: 'Question', emoji: '❓', shape: 'hex' },
  loop: { label: 'Repeat', emoji: '🔁', shape: 'hex' },
  switch: { label: 'Choose', emoji: '🔀', shape: 'hex' },
  return: { label: 'Finish', emoji: '↩️', shape: 'pill' },
  break: { label: 'Stop loop', emoji: '🛑', shape: 'pill' },
  continue: { label: 'Next round', emoji: '⏭️', shape: 'pill' },
  'pin-config': { label: 'Get ready', emoji: '⚙️', shape: 'card' },
  output: { label: 'Output', emoji: '💡', shape: 'card' },
  input: { label: 'Sense', emoji: '👀', shape: 'card' },
  wait: { label: 'Wait', emoji: '⏱️', shape: 'card' },
  serial: { label: 'Talk', emoji: '💬', shape: 'card' },
  bus: { label: 'Chip talk', emoji: '🔌', shape: 'card' },
  call: { label: 'My block', emoji: '🧩', shape: 'card' },
  trigger: { label: 'Interrupt', emoji: '⚡', shape: 'card' },
  callback: { label: 'Callback', emoji: '⚡', shape: 'card' },
  library: { label: 'Gadget', emoji: '🤖', shape: 'card' },
  declare: { label: 'Variable', emoji: '📦', shape: 'card' },
  process: { label: 'Do', emoji: '✏️', shape: 'card' },
  globals: { label: 'Setup', emoji: '📋', shape: 'card' },
};

export const kindMeta = (kind: NodeKind): KindMeta => KINDS[kind] ?? KINDS.process;

/** More specific emoji by action category (falls back to the kind's emoji). */
export const CATEGORY_EMOJI: Record<string, string> = {
  'PWM out': '🔆', Buzzer: '🔊', 'Analog in': '📈', 'Digital in': '👀', 'Pulse in': '📏', Servo: '🦾',
  'I²C': '🔌', SPI: '🔌', Variable: '📦', Init: '🔢', Step: '➕',
};
