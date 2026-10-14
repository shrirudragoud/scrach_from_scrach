// Messages between the main thread and the analyzer worker. Everything is structured-cloneable JSON.

import type { AnalyzeErrorCode, ProjectFile, WireResult } from '@codeblocks/core';
import type { ProjectOptions } from '@codeblocks/core';

export type WorkerRequest =
  | { id: number; type: 'init'; runtimeWasm: string; grammars: Record<string, string> }
  | { id: number; type: 'analyze'; files: ProjectFile[]; options: ProjectOptions };

export type WorkerResponse =
  | { id: number; ok: true; type: 'ready' }
  | { id: number; ok: true; type: 'result'; result: WireResult }
  | { id: number; ok: false; error: { code: AnalyzeErrorCode; message: string } };

/** A request without its correlation id (the client adds it). */
export type WorkerRequestBody = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
