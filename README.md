# Code → Blocks

Turns Arduino (`.ino`) code into a Scratch-style block flowchart that school kids can read, inside your Next.js IDE.

```
packages/core      engine: parse → plain-English blocks → layout (no UI, no DOM)
packages/runtime   headless createCodeBlocks() handle, worker client, Monaco binding (zustand optional)
packages/konva     react-konva renderer (pan/zoom, selection, guided run, PNG)
packages/react     <BlocksPanel/> + hooks
packages/agent     read + navigate tools for an AI chat agent
apps/web           reference Next 16 app (Monaco + panel) — copy ideas, not the app
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

```bash
node scripts/pack.mjs            # builds .pack/tarballs/codeblocks-*.tgz (add --smoke to verify in a clean project)
npx codeblocks-assets public/codeblocks   # in the host: worker + parser wasm → your public folder
```

```tsx
const blocks = useCodeBlocks({ assetBase: '/codeblocks/' });
useEffect(() => blocks?.setFiles(files, 'main.ino'), [blocks, files]);
blocks?.attachMonaco({ editor, monaco, openFile });          // when the editor mounts
{blocks && <BlocksPanel blocks={blocks} />}                   // handle is null until the first effect; or render your own from blocks.getState().scene
createAgentTools(blocks)                                      // read + navigate tools for your chat agent
```

Full guide (CSP, theming, agent wiring, Scene JSON contract, versioning): [INTEGRATION.md](INTEGRATION.md).
`apps/web/components/IdeDemo.tsx` is the whole thing in one file.

## Notes

- Konva/Monaco are client-only: load the panel with `next/dynamic({ ssr: false })` (the handle itself is SSR-safe).
- Serve `/codeblocks/*` with long cache headers (URLs carry `?v=`); serve Monaco from your own origin on school networks.
- If a build fails on `/_not-found` with `useContext` of null, check `NODE_ENV` is `production` (some shells preset it).
- Adding a language (MicroPython, C): `registerLanguage({ profile, extract })` in `packages/core`.
- Not yet covered: class methods/templates as lanes, `millis()` timer idioms in plain English, `switch` fall-through arrows.
