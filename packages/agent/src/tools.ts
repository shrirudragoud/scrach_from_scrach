// Read + navigate tools for an AI agent. Framework-neutral: each tool is { name, description,
// inputSchema (JSON Schema), run }. Map them onto your agent runtime's tool format in a few lines
// (Anthropic: { name, description, input_schema }, OpenAI: { type: 'function', function: { name, description, parameters } }).
//
// The tools never change code: "navigate" means selecting/highlighting a block (the editor binding
// then scrolls to its lines). Edits stay in the host editor, under the host's own undo/permissions.

import { buildTour, findNodeAt } from '@codeblocks/core';
import type { Diagnostic, Scene } from '@codeblocks/core';
import { describeBlock, findBlocks, getBlock, getFlow, refOf, summarize } from './model.ts';

/** The slice of the `CodeBlocks` handle the tools need (so tests and other hosts can fake it). */
export interface AgentBlocks {
  getState(): {
    status: 'idle' | 'analyzing' | 'ready' | 'error';
    stale: boolean;
    scene: Scene | null;
    diagnostics: Diagnostic[];
    error: { code: string; message: string } | null;
    selectedId: string | null;
    runningId: string | null;
  };
  select(id: string | null, opts?: { reveal?: boolean }): void;
  flush(): Promise<void>;
}

export type JsonSchema = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export interface ViewStatus {
  status: string;
  /** True while a newer analysis is pending: the blocks may lag behind the editor by a moment. */
  stale: boolean;
  error?: string;
}

export type ToolResult =
  | { ok: true; result: unknown; view: ViewStatus }
  | { ok: false; error: { code: 'unknown-tool' | 'bad-arguments' | 'not-found' | 'no-blocks' | 'internal'; message: string }; view: ViewStatus };

export interface AgentToolkit {
  tools: AgentTool[];
  /** Run a tool by name. Never throws; failures come back as { ok: false }. */
  call(name: string, args?: unknown): Promise<ToolResult>;
}

export interface AgentToolsOptions {
  /** Prefix for tool names, to avoid collisions with the host's own tools. Default 'blocks_'. */
  prefix?: string;
  /** Wait for a pending analysis before answering, so the agent sees the latest code. Default true. */
  settle?: boolean;
  /** Cap on blocks returned by one flow/run-order call. Default 120. */
  maxBlocks?: number;
}

class ToolError extends Error {
  constructor(readonly code: 'bad-arguments' | 'not-found' | 'no-blocks', message: string) { super(message); }
}

const STALE_ID = 'ids change whenever the code is edited. Re-read with blocks_overview / blocks_get_function, or refer to the block by file and line.';

function str(args: Record<string, unknown>, key: string, required: true): string;
function str(args: Record<string, unknown>, key: string, required?: false): string | undefined;
function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolError('bad-arguments', `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ToolError('bad-arguments', `"${key}" must be a string.`);
  return v;
}

function int(args: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ToolError('bad-arguments', `"${key}" must be an integer between ${min} and ${max}.`);
  return v;
}

export function createAgentTools(blocks: AgentBlocks, options: AgentToolsOptions = {}): AgentToolkit {
  const prefix = options.prefix ?? 'blocks_';
  const settle = options.settle ?? true;
  const cap = options.maxBlocks ?? 120;

  const view = (): ViewStatus => {
    const s = blocks.getState();
    return { status: s.status, stale: s.stale || s.status === 'analyzing', ...(s.error ? { error: s.error.message } : {}) };
  };
  const scene = (): Scene => {
    const sc = blocks.getState().scene;
    if (!sc) throw new ToolError('no-blocks', 'There are no blocks yet: the code has not been analysed, or it has a syntax error. Check blocks_overview "problems".');
    return sc;
  };
  const need = (id: string, sc: Scene) => {
    if (!getBlock(sc, id)) throw new ToolError('not-found', `No block with id "${id}": ${STALE_ID}`);
  };

  const t = (name: string, description: string, properties: Record<string, JsonSchema>, required: string[], run: AgentTool['run']): AgentTool => ({
    name: prefix + name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    run,
  });

  const tools: AgentTool[] = [
    t('overview',
      'Summarise the program the user is looking at as a block flowchart: every function (role, size, which functions it runs), warnings on blocks, and code problems (syntax errors). Start here.',
      {}, [],
      async () => {
        const s = blocks.getState();
        const out: Record<string, unknown> = { problems: s.diagnostics.map((d) => ({ severity: d.severity, file: d.file, line: d.line, message: d.message })) };
        if (s.scene) {
          Object.assign(out, summarize(s.scene));
          const sel = s.selectedId ? describeBlock(s.scene, s.selectedId, s) : undefined;
          if (sel) out.selected = refOf(getBlock(s.scene, sel.id)!);
        }
        return out;
      }),

    t('get_function',
      'List the blocks of one function in execution order with where each leads next (yes/no branches, loop-backs). Use the function names from blocks_overview.',
      { name: { type: 'string', description: 'Function name, e.g. "loop" or "blinkLed".' } }, ['name'],
      async (a) => {
        const name = str(a, 'name', true);
        const flow = getFlow(scene(), name, { maxBlocks: cap });
        if (!flow) throw new ToolError('not-found', `No function named "${name}". Use a name from blocks_overview.`);
        return flow;
      }),

    t('get_block',
      'Full detail for one block: plain-English explanation, original code, the function it belongs to, what it runs, warnings, and the blocks before and after it.',
      { id: { type: 'string' }, file: { type: 'string', description: 'Alternative to id: source file …' }, line: { type: 'integer', minimum: 1, description: '… and 1-based line in it.' } }, [],
      async (a) => {
        const sc = scene();
        const s = blocks.getState();
        const id = resolveId(a, sc);
        const d = describeBlock(sc, id, s);
        if (!d) throw new ToolError('not-found', `No block with id "${id}": ${STALE_ID}`);
        return d;
      }),

    t('find',
      'Search blocks by words in their title, explanation, code or category (all words must match). Optionally restrict to a kind such as "decision", "loop", "output", "wait", "call".',
      { query: { type: 'string' }, kind: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['query'],
      async (a) => findBlocks(scene(), str(a, 'query', true), { kind: str(a, 'kind'), limit: int(a, 'limit', 1, 100) })),

    t('get_selection',
      'The block the user currently has selected (clicked, or under their editor cursor) and the one being highlighted by the guided run, if any.',
      {}, [],
      async () => {
        const s = blocks.getState();
        const pick = (id: string | null) => (id && s.scene ? describeBlock(s.scene, id, s) ?? null : null);
        return { selected: pick(s.selectedId), running: pick(s.runningId) };
      }),

    t('select',
      'Select a block so the user sees it highlighted on the canvas, and (by default) scroll their editor to its code. Give an id, or a file and line. Use clear:true to deselect. Only navigates; it never edits code.',
      {
        id: { type: 'string' },
        file: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        reveal: { type: 'boolean', description: 'Also scroll the editor to the block. Default true.' },
        clear: { type: 'boolean' },
      }, [],
      async (a) => {
        if (a.clear === true) { blocks.select(null); return { selected: null }; }
        const sc = scene();
        const id = resolveId(a, sc);
        if (a.reveal !== undefined && typeof a.reveal !== 'boolean') throw new ToolError('bad-arguments', '"reveal" must be a boolean.');
        blocks.select(id, { reveal: a.reveal !== false });
        return { selected: describeBlock(sc, id, { selectedId: id }) };
      }),

    t('run_order',
      'The order blocks would run in on the board, as the "Watch it run" walkthrough shows it (setup once, then loop; yes/no questions alternate). Illustrative: it does not evaluate conditions.',
      { max_steps: { type: 'integer', minimum: 1, maximum: 200 } }, [],
      async (a) => {
        const steps = buildTour(scene(), { maxSteps: Math.min(int(a, 'max_steps', 1, 200) ?? cap, cap) });
        return { steps: steps.map((s, i) => ({ step: i + 1, ...refOf(s.node), ...(s.via?.label ? { after: s.via.label } : {}) })) };
      }),
  ];

  function resolveId(a: Record<string, unknown>, sc: Scene): string {
    const id = str(a, 'id');
    if (id) { need(id, sc); return id; }
    const file = str(a, 'file');
    const line = int(a, 'line', 1, 10_000_000);
    if (file && line) {
      const n = findNodeAt(sc, file, line);
      if (!n) throw new ToolError('not-found', `No block covers ${file}:${line}.`);
      return n.id;
    }
    throw new ToolError('bad-arguments', 'Give either "id", or both "file" and "line".');
  }

  const byName = new Map(tools.map((x) => [x.name, x]));

  return {
    tools,
    async call(name, args) {
      const tool = byName.get(name);
      if (!tool) return { ok: false, error: { code: 'unknown-tool', message: `Unknown tool "${name}".` }, view: view() };
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        return { ok: false, error: { code: 'bad-arguments', message: 'Arguments must be a JSON object.' }, view: view() };
      }
      try {
        if (settle && blocks.getState().status === 'analyzing') await blocks.flush();
        const result = await tool.run((args ?? {}) as Record<string, unknown>);
        return { ok: true, result, view: view() };
      } catch (e) {
        if (e instanceof ToolError) return { ok: false, error: { code: e.code, message: e.message }, view: view() };
        return { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e) }, view: view() };
      }
    },
  };
}
