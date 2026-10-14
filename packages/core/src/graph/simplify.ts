import { walkStmts } from '../ir.ts';
import type { ActionKind, ActionStmt, LanguageProfile, Program, Stmt } from '../types.ts';

/** Assign function roles (setup/loop/isr/callback/user) from the profile and from registration calls. */
export function resolveRoles(program: Program, profile: LanguageProfile): Program {
  const byName = new Map(program.functions.map((f) => [f.name, f]));
  for (const [name, entry] of Object.entries(profile.entryPoints)) {
    const f = byName.get(name);
    if (f) {
      Object.assign(f, {
        role: entry.role, description: entry.description, startLabel: entry.startLabel, startEmoji: entry.startEmoji,
        repeats: !!entry.repeats, endTitle: entry.endTitle,
      });
    }
  }
  for (const f of program.functions) {
    walkStmts(f.body, (s) => {
      if (s.t !== 'action' || !s.ref) return;
      const target = byName.get(s.ref);
      if (!target) return;
      (target.calledBy ??= []).push(f.name);
      if (s.refRole && target.role === 'user') {
        target.role = s.refRole;
        target.description = s.refRole === 'isr' ? 'Jumps in RIGHT AWAY when something happens' : 'Runs later, when a library asks for it';
        target.startLabel = s.refRole === 'isr' ? s.when || 'When the doorbell rings' : 'When it is time';
        target.startEmoji = '⚡';
      }
    });
  }
  for (const f of program.functions) {
    if (f.role === 'user') {
      f.description = f.calledBy?.length ? `My own block, used by ${[...new Set(f.calledBy)].join(', ')}` : 'My own block';
      f.startLabel = 'When this block is used';
      f.startEmoji = '🧩';
    }
  }
  return program;
}

interface GroupSpec {
  category: string;
  title: (n: number) => string;
  friendly: (n: number) => string;
}

const GROUPS: Partial<Record<ActionKind, GroupSpec>> = {
  'pin-config': { category: 'Get ready', title: (n) => `Configure ${n} pins`, friendly: () => 'Get the pins ready' },
  declare: { category: 'Variables', title: (n) => `Declare ${n} variables`, friendly: (n) => `Make ${n} variables` },
};

/** Merge runs of adjacent pinMode(...) calls / plain declarations into one multi-line card. */
export function groupStatements(stmts: Stmt[], groupKinds: ActionKind[] = ['pin-config']): Stmt[] {
  const kinds = new Set<ActionKind>([...groupKinds, 'declare']);
  const out: Stmt[] = [];
  for (let i = 0; i < stmts.length; ) {
    const s = stmts[i];
    if (s.t === 'action' && kinds.has(s.kind) && !s.error) {
      let j = i;
      while (j < stmts.length) {
        const n = stmts[j];
        if (n.t !== 'action' || n.kind !== s.kind || n.error) break;
        j++;
      }
      const run = stmts.slice(i, j) as ActionStmt[];
      const g = GROUPS[s.kind];
      if (run.length > 1 && g) {
        out.push({
          t: 'action', kind: s.kind, category: g.category, title: g.title(run.length), friendly: g.friendly(run.length),
          lines: run.map((r) => r.title), friendlyLines: run.map((r) => r.shortFriendly || r.friendly || r.title), text: run.map((r) => r.text).join(' '),
          loc: { start: run[0].loc.start, end: run[run.length - 1].loc.end },
        });
        i = j;
        continue;
      }
    }
    out.push(s);
    i++;
  }
  return out;
}

export function groupProgram(program: Program, profile: LanguageProfile): Program {
  const rec = (list: Stmt[]): Stmt[] => {
    const grouped = groupStatements(list, profile.groupKinds);
    for (const s of grouped) {
      if (s.t === 'if') { s.then = rec(s.then); s.else = rec(s.else); }
      else if (s.t === 'loop') s.body = rec(s.body);
      else if (s.t === 'switch') for (const c of s.cases) c.body = rec(c.body);
    }
    return grouped;
  };
  for (const f of program.functions) f.body = rec(f.body);
  return program;
}
