// The host app's Zustand store, with the block view composed in as one slice.
// This is exactly how the IDE's existing store would adopt it.

import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import type { ProjectFile } from '@codeblocks/core';
import { createBlocksSlice } from '@codeblocks/runtime';
import type { BlocksSlice } from '@codeblocks/runtime';
import { DEFAULT_SAMPLE, SAMPLES } from './samples.ts';

export interface WorkspaceSlice {
  sampleId: string;
  files: ProjectFile[];
  main: string;
  activeFile: string;
  loadSample(id: string): void;
  setActiveFile(name: string): void;
  setFileContent(name: string, content: string): void;
}

export type AppState = WorkspaceSlice & BlocksSlice;

const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set) => {
  const first = SAMPLES[DEFAULT_SAMPLE];
  return {
    sampleId: DEFAULT_SAMPLE,
    files: first.files,
    main: first.main,
    activeFile: first.main,
    loadSample: (id) => {
      const s = SAMPLES[id];
      if (s) set({ sampleId: id, files: s.files, main: s.main, activeFile: s.main });
    },
    setActiveFile: (name) => set({ activeFile: name }),
    setFileContent: (name, content) => set((st) => ({ files: st.files.map((f) => (f.name === name ? { ...f, content } : f)) })),
  };
};

export const useAppStore = create<AppState>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createBlocksSlice<AppState>()(...a),
}));
