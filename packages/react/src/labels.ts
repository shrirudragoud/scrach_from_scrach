// Every user-facing string of the panel (the engine's block text is separate). Override any subset via
// <BlocksPanel labels={{ play: 'Lancer' }} /> — the hook for translating the UI.

export interface PanelLabels {
  play: string;
  stop: string;
  realCode: string;
  fit: string;
  savePng: string;
  zoomIn: string;
  zoomOut: string;
  thinking: string;
  blocksCount: (blocks: number, ms: number) => string;
  typos: (n: number) => string;
  hintTitle: string;
  hintText: string;
  noCode: string;
  stale: string;
  errorTitle: string;
  retry: string;
  crashed: string;
}

export const defaultLabels: PanelLabels = {
  play: '▶ Watch it run',
  stop: '⏹ Stop',
  realCode: 'real code',
  fit: '🔍 Fit',
  savePng: '⬇ PNG',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  thinking: 'thinking…',
  blocksCount: (blocks, ms) => `${blocks} blocks · ${ms} ms`,
  typos: (n) => `${n} typo${n === 1 ? '' : 's'} to fix — the rest is still shown`,
  hintTitle: 'Click a block!',
  hintText: 'Click any block (or a line of code) to learn what it does — or press “Watch it run”.',
  noCode: 'Write some code and its blocks will appear here.',
  stale: 'Showing your last good picture',
  errorTitle: 'Could not draw this',
  retry: 'Try again',
  crashed: 'The block picture hit a problem and was paused. Your code is not affected.',
};
