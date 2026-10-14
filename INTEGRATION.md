# Integrating Code → Blocks into an existing IDE

For a host that already has a Monaco editor, its own canvas, and an agent chat panel (React 18 or 19, Vite or Next).

| Package | What it is | Needs React? |
| --- | --- | --- |
| `@codeblocks/core` | Engine: code → `Scene` (plain JSON). No DOM. | no |
| `@codeblocks/runtime` | Headless handle `createCodeBlocks()`, worker client, Monaco binding | no |
| `@codeblocks/konva` | Konva renderer for a `Scene` | yes |
| `@codeblocks/react` | `<BlocksPanel>` + hooks | yes |
| `@codeblocks/agent` | Read + navigate tools for your chat agent | no |

Use only what you need. Headless use (`core` + `runtime` + `agent`) pulls in no React and no Konva.

## 1. Install (tarballs)

```bash
# in this repo
node scripts/pack.mjs            # → .pack/tarballs/codeblocks-*.tgz   (add --smoke to verify in a clean project)

# in the host
npm install ./vendor/codeblocks-core-0.2.0.tgz ./vendor/codeblocks-runtime-0.2.0.tgz \
            ./vendor/codeblocks-konva-0.2.0.tgz ./vendor/codeblocks-react-0.2.0.tgz ./vendor/codeblocks-agent-0.2.0.tgz
npm install konva react-konva   # peers of the renderer; zustand only if you use @codeblocks/runtime/zustand
```

Sibling versions are pinned exactly, so install the tarballs together (or add an `overrides` entry per package pointing at the tarball).
All packages share one version number; upgrade them as a set.

## 2. Serve the analyzer assets

The parser runs in a Web Worker and needs a bundled worker script plus two wasm files. Copy them into a folder you serve:

```bash
npx codeblocks-assets public/codeblocks      # analyzer.worker.js, tree-sitter.wasm, tree-sitter-cpp.wasm, version.txt
```

Run it from a `postinstall`/`predev`/`prebuild` script so it never drifts from the installed version. Pass the folder's URL as `assetBase`.
`version.txt` is appended as `?v=` to the URLs, so you can cache `/codeblocks/*` immutably.

### Security / CSP

- No network calls are made by this code. Everything is loaded from `assetBase`.
- `worker-src` must allow the asset origin (same-origin: `'self'`).
- `script-src` needs `'wasm-unsafe-eval'` (WebAssembly compile), nothing else, no `unsafe-eval`.
- `connect-src` for the asset origin (the worker fetches the `.wasm` files).
- Analysis is bounded: input size limits, a per-request timeout, and a worker respawn on hang; failures arrive as typed errors (below).

## 3. The handle

```ts
import { createCodeBlocks } from '@codeblocks/runtime';

const blocks = createCodeBlocks({
  assetBase: '/codeblocks/',
  assetVersion,                       // contents of version.txt, optional cache-buster
  onError: (e) => log(e.code, e.message),   // AnalyzeError codes: 'too-large' | 'too-complex' | 'unsupported-language' | 'parser-unavailable' | 'internal'
});

blocks.setFiles([{ name: 'main.ino', content }], 'main.ino');   // or updateFile / removeFile / setMain
blocks.getState();                    // { status, scene, stale, error, diagnostics, selectedId, playing, … }
blocks.subscribe((state) => { … });
blocks.select(id, { reveal: true }); blocks.selectByLocation('main.ino', 12);
blocks.play(); blocks.stop();
blocks.dispose();                     // idempotent
```

- Construction is inert: the worker starts on the first analysis, so creating the handle during render/SSR is safe.
- Latest edit wins; a failed analysis keeps the last good scene (`stale: true`) and reports through `onError`.
- State lives in an in-memory store by default. To keep it in your own store pass `state: { get, patch, subscribe }`
  (`createMemoryAdapter()` is the reference; `@codeblocks/runtime/zustand` has `blocksAdapter(store)` for Zustand).

## 4. Monaco

```ts
const binding = blocks.attachMonaco({ editor, monaco, openFile: (name) => host.openTab(name) });
```

Only a small structural subset of Monaco is used (`EditorLike`, `MonacoLike`), so it works with whichever Monaco/loader version the host ships.
It feeds edits into the analysis, mirrors the cursor into block selection, highlights the selected/running line, and shows diagnostics as markers.
`blocks.dispose()` detaches it; `binding.dispose()` detaches just the editor. Both are safe to call twice.

## 5. React panel

```tsx
import { BlocksPanel, useCodeBlocks } from '@codeblocks/react';
import '@codeblocks/react/styles.css';

function BlocksView({ files }) {
  const blocks = useCodeBlocks({ assetBase: '/codeblocks/', onError });   // null on the first render; created in an effect (StrictMode-safe, disposed on unmount)
  useEffect(() => blocks?.setFiles(files, files[0].name), [blocks, files]);
  return blocks ? <BlocksPanel blocks={blocks} onError={reportRenderCrash} style={{ height: '100%' }} /> : null;
}
```

- Konva needs the DOM: in Next, load the panel with `next/dynamic(..., { ssr: false })` (or `'use client'` + dynamic import). The handle itself is SSR-safe.
- A rendering bug in the canvas is caught by an error boundary and replaced by a small notice (retry resets); it cannot take the host page down.
- Read state elsewhere in the host with `useBlocksState(blocks, (s) => s.status)`.
- Labels: `<BlocksPanel labels={{ play: 'Lancer' }} />`. Chrome: `features={{ toolbar: false, explain: false, zoomButtons: false }}`.
- Canvas control: `canvasRef` gives `fit() / zoomBy() / centerOn() / toDataURL()`.

### Theming

Every class is prefixed `.cb-` and no element, `body` or `:root` selector is touched (the only other class names are the two Monaco line decorations,
`codeblocks-line-selected` / `codeblocks-line-running`). The variable defaults sit on `:where(.cb-panel)` (zero specificity), so setting a variable on the panel
or any ancestor wins regardless of stylesheet order:

```css
.my-host .cb-panel { --cb-green: #2ea36b; --cb-radius: 8px; --cb-font: Inter, sans-serif; }
```

Variables: `--cb-ink --cb-muted --cb-card --cb-card-ink --cb-card-muted --cb-green --cb-dark --cb-dark-ink --cb-dark-hover --cb-bg --cb-dot --cb-danger --cb-danger-ink --cb-danger-bg --cb-code-bg --cb-radius --cb-font --cb-mono`.
Block colours on the canvas come from the `theme` prop (`defaultTheme` from `@codeblocks/konva`).

## 6. Letting the agent chat panel read and navigate

```ts
import { createAgentTools } from '@codeblocks/agent';

const toolkit = createAgentTools(blocks);          // options: { prefix: 'blocks_' }
```

`toolkit.tools` is a list of `{ name, description, inputSchema, run }` with plain JSON Schema, so it maps onto any provider:

```ts
// Anthropic
tools: toolkit.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
// OpenAI
tools: toolkit.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))

// when the model calls one (never throws):
const result = await toolkit.call(name, args);     // { ok: true, result, view } | { ok: false, error: { code, message }, view }
```

| Tool | Use |
| --- | --- |
| `blocks_overview` | Program summary: functions, who calls whom, what each does, warnings |
| `blocks_get_function` | Ordered flow of one function, with branch labels and loops |
| `blocks_get_block` | One block in detail, by `id` or by `file` + `line` |
| `blocks_find` | Search blocks by text/kind |
| `blocks_get_selection` | What the user is looking at (the block under their cursor / click) |
| `blocks_select` | Highlight a block and reveal its line in the editor |
| `blocks_run_order` | The order blocks run in a loop iteration |

Notes for the agent loop:

- Every call first waits for a pending analysis, so answers describe the code as it is now. `view: { status, stale, error? }` says whether it is current.
- Block ids are regenerated on every analysis. Refer to blocks by `file` + `line` across turns; ids are only valid within one answer. A stale id returns `not-found` with an explanation.
- The tools are read-only. Edits remain the host editor's job (apply the agent's suggested change through your own edit path; the blocks update by themselves).
- Nothing is sent anywhere by the tools; results are text/JSON for you to hand to your model.

## 7. Using your own renderer (the Scene contract)

`blocks.getState().scene` (or `analyzeProject(files)` from core) is plain, JSON-serialisable data. `Scene.version` (`SCENE_VERSION`, currently **3**) versions it:

```
Scene { version, mode, language, bounds, lanes[], nodes[], edges[], regions[], links[] }
Node  { id, kind, shape, category, x, y, w, h, emoji, titleLines[], subLines[], lines[], code, explain, ref,
        lane?, loc?, src? {file,start,end}, text?, warn?, error? }
Edge  { id, from, to, kind: 'flow'|'branch'|'back', label, labelAt, tone, points[[x,y]…] }
```

Geometry is already laid out (scene units, y down); a renderer only draws and handles hit-testing. `src` locations are 1-based inclusive lines in the user's file.
`packages/core/test/contract.test.ts` pins this shape; a failing contract test means you are changing the contract.

## 8. Versioning policy

- One version for all packages. Patch: fixes. Minor: additive (new optional fields, new tools). Major or `SCENE_VERSION` bump: any removed/renamed Scene field or tool, or changed tool semantics.
- Check `scene.version === SCENE_VERSION` if you render it yourself.

## 9. Compatibility

- React 18.2+ / 19, Konva 9.3+ / 10, react-konva 18.2.10+ / 19. The reference app and tests run React 19; see `scripts/smoke.mjs --react 18` for the React 18 install check.
- ESM only. Node 20+ for `@codeblocks/runtime/node` (tests/headless use).
