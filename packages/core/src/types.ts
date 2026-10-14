// Shared type vocabulary: the IR (language-neutral program), the Scene (positioned output) and options.
// The Scene is the public, versioned contract between the engine and any renderer.

import type { SyntaxNode } from './parser.ts';

// ---------------------------------------------------------------------------------------------
// source locations
// ---------------------------------------------------------------------------------------------

/** 1-based inclusive line range in the *combined* source the parser saw. */
export interface Loc {
  start: number;
  end: number;
}

/** Same range expressed in the user's own file (multi-file projects). */
export interface SourceLoc extends Loc {
  file: string;
}

// ---------------------------------------------------------------------------------------------
// IR
// ---------------------------------------------------------------------------------------------

export type ActionKind =
  | 'pin-config' | 'output' | 'input' | 'wait' | 'serial' | 'bus' | 'call'
  | 'trigger' | 'callback' | 'library' | 'declare' | 'process' | 'globals';

export type NodeKind = ActionKind | 'start' | 'end' | 'decision' | 'loop' | 'switch' | 'return' | 'break' | 'continue';

export interface ActionStmt {
  t: 'action';
  kind: ActionKind;
  category?: string;
  /** Technical wording (code view). */
  title: string;
  /** Plain-English wording (kids view). */
  friendly?: string;
  shortFriendly?: string;
  sub?: string;
  when?: string;
  lines?: string[];
  friendlyLines?: string[];
  /** Original source text of the statement. */
  text: string;
  loc: Loc;
  ref?: string | null;
  refRole?: 'isr' | 'callback';
  warn?: string;
  error?: string;
  blocking?: boolean;
  explain?: string;
  group?: boolean;
  role?: 'loop-init' | 'loop-step';
}

export interface IfStmt {
  t: 'if';
  cond: string;
  friendly: string;
  then: Stmt[];
  else: Stmt[];
  loc: Loc;
  headLoc: Loc;
}

export interface LoopStmt {
  t: 'loop';
  form: 'while' | 'for' | 'do' | 'range';
  cond: string;
  friendly: string;
  friendlySub?: string | null;
  body: Stmt[];
  /** A recognised `for (i = a; i < n; i++)` counting loop. */
  count?: boolean;
  loc: Loc;
  headLoc: Loc;
}

export interface SwitchCase {
  labels: string[];
  friendlyLabel: string;
  isDefault: boolean;
  body: Stmt[];
  fallsThrough: boolean;
}

export interface SwitchStmt {
  t: 'switch';
  expr: string;
  friendly: string;
  cases: SwitchCase[];
  loc: Loc;
  headLoc: Loc;
}

export interface ReturnStmt { t: 'return'; value: string; loc: Loc }
export interface BreakStmt { t: 'break'; loc: Loc }
export interface ContinueStmt { t: 'continue'; loc: Loc }

export type Stmt = ActionStmt | IfStmt | LoopStmt | SwitchStmt | ReturnStmt | BreakStmt | ContinueStmt;

export type FunctionRole = 'setup' | 'loop' | 'isr' | 'callback' | 'user';

export interface Func {
  name: string;
  params: string[];
  returnType: string;
  signature: string;
  body: Stmt[];
  loc: Loc;
  role: FunctionRole;
  description?: string;
  startLabel?: string;
  startEmoji?: string;
  repeats?: boolean;
  endTitle?: string;
  calledBy?: string[];
}

export interface Global {
  kind: 'include' | 'define' | 'macro' | 'var';
  text: string;
  friendly?: string;
  line: number;
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  line: number;
  column: number;
  message: string;
  /** Set for multi-file projects; `line` is then relative to this file. */
  file?: string;
}

export interface Program {
  language: string;
  globals: Global[];
  functions: Func[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------------------------
// language plug-ins
// ---------------------------------------------------------------------------------------------

export interface CallInfo {
  name: string;
  object: string | null;
  method: string | null;
  args: string[];
}

/** What the adapter knows about one simple statement; handed to the profile to describe it. */
export interface StatementInfo {
  calls: CallInfo[];
  target: string | null;
  isDecl: boolean;
  exprText: string;
  exprIsBareCall: boolean;
  /** `, and remember it as “x”` or '' — set by the profile hook before describing. */
  save?: string;
}

export interface ProfileContext {
  consts: Map<string, string>;
  objectTypes: Map<string, string>;
  userFns: Set<string>;
}

export interface EntryPoint {
  role: 'setup' | 'loop';
  description: string;
  startLabel: string;
  startEmoji: string;
  endTitle?: string;
  repeats?: boolean;
}

/** Domain knowledge for one language/platform (Arduino API, MicroPython `machine`, ESP-IDF, …). */
export interface LanguageProfile {
  id: string;
  grammar: string;
  extensions: string[];
  entryPoints: Record<string, EntryPoint>;
  groupKinds: ActionKind[];
  plainCondition?(text: string, ctx: ProfileContext): string;
  describeStatement(info: StatementInfo, ctx: ProfileContext): Partial<ActionStmt> | null;
  describeGlobal?(g: Global): string;
  annotate?(program: Program): void;
}

/** A language = a profile + the adapter that turns its syntax tree into the IR. */
export interface LanguageDefinition {
  profile: LanguageProfile;
  extract(root: SyntaxNode, source: string, profile: LanguageProfile): Program;
}

// ---------------------------------------------------------------------------------------------
// Scene (renderer contract)
// ---------------------------------------------------------------------------------------------

export type SceneMode = 'kids' | 'code';
export type NodeShape = 'card' | 'hex' | 'pill' | 'hat';
export type Point = [number, number];

export interface SceneNode {
  id: string;
  kind: NodeKind;
  shape: NodeShape;
  /** Centre x, top y. */
  x: number;
  y: number;
  w: number;
  h: number;
  emoji: string;
  category: string;
  titleLines: string[];
  subLines: string[];
  lines: string[];
  /** Real code shown under the friendly text (kids view). */
  code: string | null;
  explain: string;
  loc?: Loc;
  src?: SourceLoc;
  warn?: string;
  error?: string;
  ref: string | null;
  text?: string;
  lane?: string;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  kind: 'flow' | 'branch' | 'back';
  label: string;
  tone: 'yes' | 'no' | null;
  points: Point[];
  labelAt: Point | null;
}

export type LaneRole = FunctionRole | 'globals';

export interface SceneLane {
  id: string;
  name: string;
  description?: string;
  role: LaneRole;
  fn?: string;
  loc?: Loc;
  src?: SourceLoc;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneRegion {
  kind: 'loop';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneLink {
  from: string;
  toLane: string;
  kind: NodeKind;
}

export interface Scene {
  version: number;
  mode: SceneMode;
  language: string;
  lanes: SceneLane[];
  nodes: SceneNode[];
  edges: SceneEdge[];
  regions: SceneRegion[];
  links: SceneLink[];
  bounds: { w: number; h: number };
}

export const SCENE_VERSION = 3;

// ---------------------------------------------------------------------------------------------
// options & results
// ---------------------------------------------------------------------------------------------

/** Average glyph width (px per character) of the font the renderer will actually use. */
export interface TextMetrics {
  /** 15px bold UI text. */
  title: number;
  /** 12px secondary text. */
  small: number;
  /** 11.5px monospace code. */
  mono: number;
}

export const DEFAULT_METRICS: TextMetrics = { title: 8.3, small: 6.6, mono: 6.9 };

export interface Limits {
  /** Refuse sources larger than this many characters (protects the main thread / worker). */
  maxSourceChars: number;
  /** Refuse to draw more blocks than this; callers should offer a collapsed view instead. */
  maxNodes: number;
}

export const DEFAULT_LIMITS: Limits = { maxSourceChars: 300_000, maxNodes: 2_500 };

export interface AnalyzeOptions {
  language?: string;
  mode?: SceneMode;
  showCode?: boolean;
  groupConsecutive?: boolean;
  metrics?: Partial<TextMetrics>;
  limits?: Partial<Limits>;
}

export interface ProjectFile {
  name: string;
  content: string;
}

export interface AnalyzeStats {
  ms: number;
  nodes: number;
  edges: number;
  functions: number;
  files: number;
}

/** What crosses the worker boundary: no IR, just what a renderer/IDE needs. */
export interface WireResult {
  scene: Scene;
  diagnostics: Diagnostic[];
  stats: AnalyzeStats;
}

export interface AnalyzeResult extends WireResult {
  program: Program;
}

export type AnalyzeErrorCode = 'too-large' | 'too-complex' | 'unsupported-language' | 'parser-unavailable' | 'internal';

export class AnalyzeError extends Error {
  readonly code: AnalyzeErrorCode;
  constructor(code: AnalyzeErrorCode, message: string) {
    super(message);
    this.name = 'AnalyzeError';
    this.code = code;
  }
}
