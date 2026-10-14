# Code → Blocks

Turns Arduino (`.ino`) code into a Scratch-style block flowchart that school kids can read, inside your Next.js IDE.

```
packages/core      engine: parse → plain-English blocks → layout (no UI, no DOM)
packages/runtime   worker, analyzer client, controller, Zustand slice, Monaco binding
packages/konva     react-konva renderer (pan/zoom, selection, guided run, PNG)
packages/react     <BlocksPanel/> + hooks
apps/web           reference Next 16 app (Monaco + Zustand + panel) — copy ideas, not the app
```

## Run it locally

Needs Node 20.9+ (Next 16).

```bash
npm install
npm test                      # unit tests (core, runtime, konva)

cd apps/web
npm run dev                   # copies worker/wasm/Monaco into public/, then starts http://localhost:3100
```

Production check: `NODE_ENV=production npm run build && npm start` (run from `apps/web`).
Browser tests (needs a Chromium; set `CHROMIUM_PATH` if it is not auto-found): `npm run e2e` from `apps/web` after a build.
Real-sketch run: `npm run corpus -- /path/to/arduino-examples`.

## Plug into the IDE

1. Copy the four `packages/*` folders; add them to `transpilePackages`; `import '@codeblocks/react/styles.css'` once.
2. `npx codeblocks-assets public/codeblocks` (worker + parser wasm → your public folder).
3. Store: `...createBlocksSlice()(...a)` into your Zustand store.
4. Page: `const controller = useBlocksController({ store: useAppStore })`, render `<BlocksPanel controller state={useBlocksState(useAppStore)} />`,
   and `attachMonaco({ controller, state: blocksAdapter(useAppStore), editor, monaco, openFile })` when the editor mounts.
   Feed files with `controller.setFiles(files, mainFile)`.

See `apps/web/components/IdeDemo.tsx` for all of it in one file.

## Notes

- Konva/Monaco are client-only: load the panel with `next/dynamic({ ssr: false })`.
- Serve `/codeblocks/*` with long cache headers (URLs carry `?v=`); serve Monaco from your own origin on school networks.
- If a build fails on `/_not-found` with `useContext` of null, check `NODE_ENV` is `production` (some shells preset it).
- Adding a language (MicroPython, C): `registerLanguage({ profile, extract })` in `packages/core`.
- Not yet covered: class methods/templates as lanes, `millis()` timer idioms in plain English, `switch` fall-through arrows.
