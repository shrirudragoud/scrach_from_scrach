import type { Stmt } from './types.ts';

/** Depth-first visit of every statement in a body, descending into branches, loops and cases. */
export function walkStmts(stmts: Stmt[] | undefined, fn: (s: Stmt) => void): void {
  for (const s of stmts ?? []) {
    fn(s);
    if (s.t === 'if') { walkStmts(s.then, fn); walkStmts(s.else, fn); }
    else if (s.t === 'loop') walkStmts(s.body, fn);
    else if (s.t === 'switch') for (const c of s.cases) walkStmts(c.body, fn);
  }
}
