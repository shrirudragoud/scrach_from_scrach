// Language registry: adding MicroPython / ESP-IDF / STM32 later = one `registerLanguage()` call with a
// profile (domain knowledge) and an adapter (syntax tree -> IR). Nothing else in the engine changes.

import { extractProgram } from './lang/cfamily.ts';
import { arduino } from './profiles/arduino.ts';
import { AnalyzeError } from './types.ts';
import type { LanguageDefinition } from './types.ts';

const registry = new Map<string, LanguageDefinition>();

export function registerLanguage(def: LanguageDefinition, aliases: string[] = []): void {
  for (const id of [def.profile.id, ...aliases]) registry.set(id, def);
}

export function getLanguage(id: string): LanguageDefinition {
  const def = registry.get(id);
  if (!def) throw new AnalyzeError('unsupported-language', `Unsupported language "${id}". Supported: ${[...registry.keys()].join(', ')}`);
  return def;
}

export const supportedLanguages = (): string[] => [...registry.keys()];

export function languageForFile(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [id, def] of registry) if (def.profile.extensions.some((e) => lower.endsWith(e))) return id;
  return null;
}

registerLanguage({ profile: arduino, extract: extractProgram }, ['ino', 'cpp']);
