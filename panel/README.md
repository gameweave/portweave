# Portweave panel — frontend app

This directory is the standalone **Vite + React + TypeScript** app behind `portweave panel`. It builds to repo-root `dist/panel/` as plain static assets, which the `portweave panel` server serves from a loopback-only `node:http` endpoint. It is a read-only dashboard of every machine-wide port allocation, grouped project → worktree → service, with clickable preview links and per-port liveness status.

The app is intentionally isolated: it has its own `package.json`, `tsconfig.json`, and `node_modules`, so its JSX/TSX and bundler never touch the backend's lint/typecheck/knip gates. The only thing the backend (and the published package) sees is the built output in `dist/panel/`.

## Develop

```bash
cd panel
npm install
npm run dev
```

`npm run dev` starts Vite with hot-module reloading. The dev server proxies `/api` to a running `portweave panel` (default `http://127.0.0.1:7733`), so for live data, start the panel in another terminal:

```bash
# from the repo root, in a second terminal
portweave panel
```

The frontend then fetches `/api/allocations` from the proxied backend and re-renders on the Refresh button while you edit components with HMR.

## Build

```bash
# from the repo root
npm run build
```

The root `build` compiles the backend with `tsc` and then runs `vite build` in this app, emitting `index.html` + hashed assets into repo-root `dist/panel/`. There is no separate frontend build step for publishing — the root `build` produces everything, and `dist/panel/` is already inside the package's published `files`.

## Runtime dependencies stay zero

React, Vite, and everything else under `panel/` are **build-time only**. They live in this app's `package.json`, never in the root `package.json` `dependencies`. The published package's runtime dependency closure is unchanged: the panel server uses Node's built-in `node:http`, and the UI ships as the pre-built static assets in `dist/panel/`.
