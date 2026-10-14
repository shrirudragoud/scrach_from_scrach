export const collapse = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();

export function truncate(s: string | null | undefined, n: number): string {
  const t = collapse(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Greedy word wrap (breaking over-long tokens) to at most `maxLines` lines, ellipsising overflow. */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = collapse(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= maxChars ? last.slice(0, maxChars - 1) + '…' : last + '…';
    return kept;
  }
  return lines;
}
