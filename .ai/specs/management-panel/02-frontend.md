# panel — frontend: standalone Vite + React app

**Parent:** [management-panel.md](./management-panel.md) (index)
**Sibling:** [01-server-and-api.md](./01-server-and-api.md) (the API this app consumes), [03-build-and-tooling.md](./03-build-and-tooling.md) (how this builds into `dist/panel/` and stays isolated from backend gates)

This sub-spec owns the browser app under `panel/`. The hard architectural constraint — repeated because it shapes every choice here — is **zero new runtime dependency in the published package** ([index](./management-panel.md), [DESIGN.md §3](../../DESIGN.md)): React and Vite are build-time tooling that compile to static assets; they are never in the root [package.json](../../../package.json) `dependencies`.

## Why a separate app (not part of `src/`)

The backend is pure ESM TypeScript, strict, compiled by `tsc` with `module: Node16` and `.ts`-extension relative imports ([tsconfig.base.json](../../../tsconfig.base.json), [decision-log #18](../../decision-log.md)). JSX/TSX, the React dependency graph, and a bundler do not fit that toolchain and would pollute the backend's lint/typecheck/knip gates. Isolating the frontend into its own folder with its own `package.json` / `tsconfig` / `node_modules` keeps the two worlds from contaminating each other — and is precisely what lets [03](./03-build-and-tooling.md) keep `panel/**` inert to the backend checks. The frontend's _output_ (`dist/panel/`) is the only thing the backend (and the published package) sees.

## Directory shape

```
panel/
  package.json          # devDeps: react, react-dom, vite, @vitejs/plugin-react, typescript, @types/react(-dom)
  tsconfig.json         # frontend-only TS config (DOM lib, jsx: react-jsx) — independent of root tsconfig
  vite.config.ts        # base: './', build.outDir → ../dist/panel, emptyOutDir
  index.html            # Vite entry
  src/
    main.tsx            # React root mount
    App.tsx             # fetch /api/allocations on mount + Refresh; render grouped snapshot
    api.ts              # typed fetch wrapper returning PanelSnapshot
    types.ts            # PanelSnapshot mirror (see "Type sharing" below)
    components/         # ProjectGroup, WorktreeCard, ServiceRow, LivenessBadge, EmptyState
    theme.css           # CSS variables (GitHub-dark palette)
  node_modules/         # gitignored; never published
```

`panel/node_modules/` is covered by the existing root `.gitignore` `node_modules/` rule (no leading slash → matches at any depth, [.gitignore:1](../../../.gitignore)); [03](./03-build-and-tooling.md) notes an optional explicit line.

## Vite config (the load-bearing settings)

```typescript
// panel/vite.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // relative asset URLs so dist/panel/ works served from any path
  build: {
    emptyOutDir: true,
    outDir: '../dist/panel', // emit into repo-root dist/panel/ (what the server serves & npm publishes)
  },
  plugins: [react()],
})
```

`base: './'` is mandatory: the server serves `dist/panel/index.html` from `GET /` and assets from `GET /<asset>` ([01](./01-server-and-api.md)). Absolute `/assets/...` URLs would only work if the app were mounted at the server root with a matching asset prefix; relative URLs make the bundle position-independent and match the static-serving handler. `outDir: '../dist/panel'` puts the build where the published `files: ["dist/", ...]` ([package.json:40-44](../../../package.json)) already picks it up — **no `files` change** ([03](./03-build-and-tooling.md)).

## Data flow

- `api.ts` exposes `fetchSnapshot(): Promise<PanelSnapshot>` — a thin `fetch('/api/allocations')` + `res.json()` (relative URL works because the app is served same-origin by the panel server).
- `App.tsx` holds `{ snapshot, loading, error }` state, calls `fetchSnapshot()` in a `useEffect` on mount and in the **Refresh** button's `onClick`. **No auto-poll, no WebSocket, no SSE** — manual refresh only ([feature-doc open question #4](../../features/management-panel/management-panel.md), [index](./management-panel.md) resolution; live push is deferred).
- Rendering walks `snapshot.projects → worktrees → services`:
  - **Project** → a `ProjectGroup` with the `label` header (the config's `projectName` when set, else a name derived from `gitCommonDir`; the frontend just renders the resolved string — [01](./01-server-and-api.md) owns the resolution).
  - **Worktree** → a `WorktreeCard` showing `namespace`; if `degraded`, a visible degraded marker (badge + `degradedReason`) and the card still renders its raw-port services.
  - **Service** → a `ServiceRow` showing `name`, `envVar` (when present), and the `port`. Each `PanelLink` in `links` renders as an `<a href={url} target="_blank" rel="noreferrer">` — the clickable preview link. A service with `links: []` renders a **non-clickable port chip** (still useful: you can read the port).
  - **Liveness** → a `LivenessBadge` per service driven by `status`: `live` (green) / `not running` (muted). `unknown` (reserved) renders neutrally.
  - **Empty** → when `projects` is `[]`, an `EmptyState` ("No allocations yet — run `portweave run` in a project") instead of an empty page or an error.
  - **Error/loading** → a fetch failure shows a small inline error with a retry affordance (the Refresh button); initial load shows a lightweight loading state.

## Theme

Dark theme via plain CSS custom properties in `theme.css` (GitHub-dark palette: `--bg`, `--bg-elev`, `--fg`, `--fg-muted`, `--accent`, `--ok`, `--warn`, `--border`). No UI-kit / component-library dependency — keeps the frontend devDep footprint minimal and avoids any chance of a runtime-dep leak. A light theme is explicitly out of scope ([feature doc](../../features/management-panel/management-panel.md)).

## Type sharing

`panel/src/types.ts` needs the `PanelSnapshot` contract that `src/panel/types.ts` defines ([01](./01-server-and-api.md)). Because the frontend toolchain is isolated from `src/`, it cannot `import` the backend type across the project boundary cleanly. **Decided: duplicate the type in `panel/src/types.ts`, structurally identical, with drift caught by the backend server contract test** (which asserts the served JSON's shape). Build-time type generation from the backend remains a possible later optimization, out of scope for the POC. This is the one deliberate duplication in the feature; it is small, pinned by a test, and avoids cross-toolchain import plumbing.

## Out of scope (this layer)

- **Frontend unit tests** — deferred to `panel/`'s own future vitest setup, per the [feature doc](../../features/management-panel/management-panel.md). The POC verifies the UI by manual smoke against a running `portweave panel`. (The backend pipeline that feeds the UI _is_ fully unit-tested in [01](./01-server-and-api.md), so the data contract is covered even without frontend tests.)
- Any mutation affordance (kill/release/prune/rename) — view-only POC ([decision-log #42](../../decision-log.md), [#34](../../decision-log.md)).
- Auto-refresh / live updates, light theme, auth/TLS/non-loopback — all deferred ([feature doc](../../features/management-panel/management-panel.md)).

## Acceptance criteria (this layer)

See the [index roll-up](./management-panel.md#frontend-02). The load-bearing ones:

- [ ] `panel/` is a standalone Vite + React + TS app with its own `package.json` / `tsconfig` / `node_modules`; React/Vite are absent from the **root** `package.json` `dependencies` (verified jointly with [03](./03-build-and-tooling.md)).
- [ ] `vite build` with `base: './'` emits `index.html` + hashed assets into `dist/panel/` with relative asset URLs that load when served by the panel server's static routes.
- [ ] On mount and on Refresh, the app fetches `/api/allocations` and renders the grouped snapshot: clickable links for services with `links`, non-clickable port chips for services without, liveness badges, a degraded marker on degraded worktrees, and an empty state when `projects` is `[]`. No auto-poll/WebSocket/SSE. (Manual smoke; frontend unit tests out of POC.)
- [ ] Dark theme via CSS variables only; no UI-kit dependency (verified by inspecting `panel/` imports).
