import { withTree } from './parser.ts';
import { getLanguage } from './registry.ts';
import { combineFiles, mapDiagnostics, mapLoc } from './project.ts';
import { resolveRoles, groupProgram } from './graph/simplify.ts';
import { buildScene } from './graph/layout.ts';
import { AnalyzeError, DEFAULT_LIMITS } from './types.ts';
import type { AnalyzeOptions, AnalyzeResult, ProjectFile } from './types.ts';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface ProjectOptions extends AnalyzeOptions {
  /** Main tab (analysed first, like Arduino's sketch file). Defaults to the first eligible file. */
  main?: string;
}

/**
 * Analyse a whole project. Files are combined the way the platform's compiler does; every block, lane
 * and diagnostic in the result carries the original `file` + line (`node.src`, `diagnostic.file`).
 * Throws AnalyzeError for refusals (too large / too complex / unsupported language / parser missing).
 */
export async function analyzeProject(files: ProjectFile[], options: ProjectOptions = {}): Promise<AnalyzeResult> {
  const t0 = now();
  const lang = getLanguage(options.language ?? 'arduino');
  const { maxSourceChars } = { ...DEFAULT_LIMITS, ...options.limits };

  const { source, segments } = combineFiles(files, lang.profile.extensions, options.main);
  if (source.length > maxSourceChars) {
    throw new AnalyzeError('too-large', `This sketch is ${source.length.toLocaleString('en')} characters long; the block view works up to ${maxSourceChars.toLocaleString('en')}.`);
  }

  const program = await withTree(lang.profile.grammar, source, (root) => lang.extract(root, source, lang.profile));
  resolveRoles(program, lang.profile);
  lang.profile.annotate?.(program);
  if (options.groupConsecutive ?? true) groupProgram(program, lang.profile);

  const scene = buildScene(program, { mode: options.mode, showCode: options.showCode, metrics: options.metrics, limits: options.limits });
  for (const n of scene.nodes) n.src = mapLoc(segments, n.loc);
  for (const l of scene.lanes) l.src = mapLoc(segments, l.loc);
  const diagnostics = mapDiagnostics(segments, program.diagnostics);

  return {
    program,
    scene,
    diagnostics,
    stats: {
      ms: Math.round(now() - t0),
      nodes: scene.nodes.length,
      edges: scene.edges.length,
      functions: program.functions.length,
      files: segments.length,
    },
  };
}

/** Convenience for a single source string. */
export function analyze(source: string, options: ProjectOptions & { fileName?: string } = {}): Promise<AnalyzeResult> {
  return analyzeProject([{ name: options.fileName ?? 'sketch.ino', content: source }], options);
}
