# portweave panel — read-only machine-wide preview dashboard

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/management-panel/management-panel.md](../../features/management-panel/management-panel.md)
**Decision-log rows:** [#42](../../decision-log.md) (panel reframing — read-only, on-demand, All-OSS, no-daemon-preserving), [#34](../../decision-log.md) (`PORTWEAVE_NAMESPACE` + `${pw:*}` metadata; process management stays out of scope), [#26](../../decision-log.md) (discovery URLs resolve against the allocated port), [#28](../../decision-log.md) (CLI flag handling / `PW0601`), [#17](../../decision-log.md) (PW error-code numbering — CLI block `PW06xx`), [#36](../../decision-log.md) (`import.meta.main` / symlink-safe path resolution), [#43](../../decision-log.md) (panel shipped), [#44](../../decision-log.md) (`readRegistryEntries` non-pruning read), [#45](../../decision-log.md) (`projectName` config field), [#46](../../decision-log.md) (link scheme-allowlist)

> This spec is split per the [create-spec](../../../.claude/skills/create-spec/SKILL.md) "~200 lines → numbered sub-specs" rule. The work spans three loosely-coupled layers (a backend HTTP server + enrichment pipeline, a standalone frontend app, and build/tooling integration) that are each independently substantial. This top-level file is the **index**: it owns the Problem, the cross-cutting Approach, the consolidated Acceptance criteria, the Decision-log impact, and the Open questions. The sub-specs own the per-layer detail:
>
> - [01-server-and-api.md](./01-server-and-api.md) — `src/cli/panel.ts`, `src/panel/server.ts`, `src/panel/enrich.ts`, `src/panel/types.ts`, `src/panel/liveness.ts`, and their tests.
> - [02-frontend.md](./02-frontend.md) — the standalone Vite + React + TS app under `panel/`, building to `dist/panel/`.
> - [03-build-and-tooling.md](./03-build-and-tooling.md) — root `build` wiring, ESLint/jscpd/knip/structure/gitignore isolation, and the "no new runtime dependency" guarantee.

## Problem

The machine-wide pool ([decision-log #4](../../decision-log.md), [DESIGN.md §5.1](../../DESIGN.md)) buys conflict-free ports at the cost of _visibility_: ports are now dynamic, so a developer can no longer bookmark `localhost:5173` for a feature worktree — today it might be `30002`, tomorrow `30107`. The more the model succeeds (several projects, several worktrees, agents each spinning up their own dev stack), the harder the most basic question becomes: _what is running where, and what URL do I open to preview it?_

`portweave show` ([DESIGN.md §5.2](../../DESIGN.md), [spec](../show-command/show-command.md)) answers that for **one** worktree, one invocation at a time. It does not answer the cross-cutting version: stand back and see _everything_ allocated on this machine at once. [DESIGN.md §3](../../DESIGN.md) already lists "Inspectable" as a goal and [§5.3](../../DESIGN.md) reserves machine-wide visibility for a future `portweave list`. The panel is the low-friction, visual realization of that idea: open one page, click a link, preview any running version.

The motivating request (per the [feature doc](../../features/management-panel/management-panel.md)): _"I want to easily preview any version of my projects, even when the ports are dynamic."_ The panel gives a stable home page of clickable, labeled preview links — grouped project → worktree → service — plus an at-a-glance liveness indicator that distinguishes an active preview from a stale allocation.

This deliberately reopens the [DESIGN.md §3](../../DESIGN.md) non-goal "**Web UI / dashboard.** CLI only at v0." That was a v0 scope cap, not a permanent stance; v0 has shipped. Per [decision-log #42](../../decision-log.md) the reopening is narrow: a **read-only viewer**, not the management dashboard the original non-goal connoted, positioned **All-OSS**.

### Two invariants this spec must not break

The panel touches two documented invariants. Both are preserved, and the spec is explicit about how:

1. **No daemon ([DESIGN.md §5.6](../../DESIGN.md), [decision-log #3](../../decision-log.md)).** The panel is an **on-demand, foreground** server the user starts and stops — not a background process. It coordinates nothing; it is a pure _view_ over the file-locked registry. When the user Ctrl-Cs, it is gone. This is the same posture as `portweave show` (one-shot read), just held open for the duration of one terminal session.
2. **No new runtime dependency ([DESIGN.md §3](../../DESIGN.md) minimal-deps posture; runtime deps today = `commander` + `zod` only, [package.json](../../../package.json)).** The server uses Node's built-in `node:http`; the UI ships as pre-built static assets under `dist/panel/`. React and Vite are **build-time devDependencies only** — they never enter the published dependency closure. See [03-build-and-tooling.md](./03-build-and-tooling.md).

A third, load-bearing property: **the panel never writes the registry.** Unlike `show` — which calls `handle.touch(key)` to bump `lastUsedAt` on the single worktree being inspected ([show-command spec](../show-command/show-command.md), [src/cli/show.ts:92](../../../src/cli/show.ts)) — the panel views _many_ worktrees per page load. Touching all of them on every render would mass-rewrite the registry and reset everyone's recency signal, defeating stale-pruning. The panel reads through a dedicated **non-pruning** primitive, `readRegistryEntries(env)` ([src/registry/storage.ts](../../../src/registry/storage.ts)) — lock-free, no `mkdir`, no prune, no write — and returns. It does **not** go through `withRegistry`. This matters for two reasons: `withRegistry` runs `pruneStaleEntries` on every read and rewrites the file when that prune drops a deleted-dir entry ([src/registry/storage.ts:107,115](../../../src/registry/storage.ts)) — so going through it would (a) violate the zero-write invariant on a mere read and (b) silently drop deleted-dir worktrees before the panel could ever surface them as degraded. By reading via `readRegistryEntries`, the panel is **genuinely zero-write — it does not even prune** (distinct from `withRegistry`'s prune-on-read, which is correct for `show`), and deleted-dir entries survive long enough to be shown as `degraded: 'directory deleted'`. This is asserted by test (see [01-server-and-api.md](./01-server-and-api.md)).

## Approach (cross-cutting)

`portweave panel [--port <n>]` starts a loopback-only `node:http` server, prints its URL to stderr, and blocks in the foreground until `SIGINT`/`SIGTERM`, at which point it shuts down cleanly. Every request re-reads the machine-wide registry, enriches each entry into a typed `PanelSnapshot`, and serves either that JSON (`GET /api/allocations`) or the static UI (`GET /` + asset routes). The UI fetches `/api/allocations` on mount and on a manual **Refresh** click, renders the grouped snapshot with clickable discovery-URL links and per-port liveness badges, and degrades gracefully when an entry's directory or config is gone.

The data flow mirrors `show` exactly, generalized from one worktree to all of them:

```
readRegistryEntries(env)                     // read-only, non-pruning, no lock/write — src/registry/storage.ts
  → for each entry:
      loadConfig(entry.key.worktreeRoot)     // src/config/loader.ts:70  (Allocation = RegistryEntry)
      buildEnvMap(entry, config)             // src/env/build.ts:7 — resolves ${svc} / ${pw:*} → URLs
  → group  gitCommonDir (project) → namespace (worktree) → service
  → liveness probe per port (TCP connect, parallel)   // src/panel/liveness.ts (new)
  → PanelSnapshot                            // src/panel/types.ts (new)
```

Project labels come from a **new optional `projectName` field** added to the config schema (`src/config/schema.ts` — detailed in [01](./01-server-and-api.md)): when a worktree's config sets it, that becomes the project's display label; otherwise the panel derives one from `gitCommonDir`. The field is optional and additive, so existing configs and the Gameweave parity test are unaffected.

### Module layout

Backend (all under `src/`, tested with real I/O against `os.tmpdir()` per [.claude/rules/testing.md](../../../.claude/rules/testing.md)):

| File                    | Responsibility                                                                                                                                                      | Detail in                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src/cli/panel.ts`      | Commander wiring (`registerPanelCommand`) + testable `runPanel(options)` with injected `cwd`/`env`/`stdout`/`stderr`. Mirrors `src/cli/run.ts` + `src/cli/show.ts`. | [01](./01-server-and-api.md) |
| `src/panel/server.ts`   | `node:http` server: route switch, `127.0.0.1` bind, clean shutdown, static-asset serving from `dist/panel/`.                                                        | [01](./01-server-and-api.md) |
| `src/panel/enrich.ts`   | Pure registry-entries → `PanelSnapshot`: grouping, env-map resolution, graceful degradation. No network, no http.                                                   | [01](./01-server-and-api.md) |
| `src/panel/liveness.ts` | TCP connect-with-timeout probe (the inverse of [src/allocator/probe.ts](../../../src/allocator/probe.ts)'s bind test).                                              | [01](./01-server-and-api.md) |
| `src/panel/types.ts`    | The `PanelSnapshot` contract (see below).                                                                                                                           | [01](./01-server-and-api.md) |

Frontend (standalone, isolated toolchain — its own `package.json`/`tsconfig`/`node_modules`):

| Path     | Responsibility                                                                                            | Detail in              |
| -------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| `panel/` | Vite + React + TS app; dark theme via CSS variables; builds to repo-root `dist/panel/` with `base: './'`. | [02](./02-frontend.md) |

### Existing patterns this leans on (verified by reading the code)

- **CLI command shape.** `register<Name>Command(program)` + a testable `run<Name>(options)` that accepts injectable `cwd`/`env`/`stdout`/`stderr` and returns a `Result<{ exitCode }, PortweaveError>`. Established by [src/cli/show.ts:144-197](../../../src/cli/show.ts) and [src/cli/run.ts:176-250](../../../src/cli/run.ts). `runPanel` mirrors it; the only twist is that `runPanel` is long-lived (resolves on shutdown), not one-shot.
- **Registry read.** The panel reads via `readRegistryEntries(env)` ([src/registry/storage.ts](../../../src/registry/storage.ts)) — a non-pruning, lock-free, never-writes primitive returning the insertion-ordered entries (the same `RegistryEntry[]` shape `withRegistry`'s `handle.entries` exposes, [src/registry/storage.ts:16-21,38-41](../../../src/registry/storage.ts)), with a missing registry returning `ok([])`. It deliberately does **not** use `withRegistry`, whose prune-on-read would both rewrite the file and drop deleted-dir entries the panel must surface as degraded. `env` threads `XDG_CONFIG_HOME` for test isolation ([src/registry/paths.ts:13](../../../src/registry/paths.ts)).
- **Env/URL resolution.** `buildEnvMap(allocation, config)` is the pure, no-I/O resolver that turns `discoveryEnv` templates into concrete URLs ([src/env/build.ts:7](../../../src/env/build.ts)). **It is already exported from [src/env/index.ts:1](../../../src/env/index.ts)** — `show` consumes it the same way ([src/cli/show.ts:6,120](../../../src/cli/show.ts)). No re-export work is needed (this resolves the question the show-command spec flagged about `buildEnvMap` visibility).
- **Config load.** `loadConfig(cwd, opts?)` returns `Result<Config, PortweaveError>` ([src/config/loader.ts:70](../../../src/config/loader.ts), re-exported from [src/config/index.ts:2](../../../src/config/index.ts)). `Config.services` is `ServiceSpec[]` with `name`, `envVar`, `discoveryEnv`, `group?`, `preferred?` ([src/config/schema.ts:49-62](../../../src/config/schema.ts)).
- **Port probe.** [src/allocator/probe.ts:10](../../../src/allocator/probe.ts) is a **bind** test (`'free' | 'taken'`) — the wrong polarity for liveness, which needs a **connect** test ("is something listening?"). The panel adds a small dedicated `src/panel/liveness.ts`; it does not reuse `probePort`.
- **Symlink-safe path resolution.** Resolving the bundled `dist/panel/` directory uses `fileURLToPath(new URL('...', import.meta.url))`, the pattern already used at [src/allocator/allocate.concurrent.ts:11-14](../../../src/allocator/allocate.concurrent.ts) and [src/registry/storage.concurrent.ts:11-14](../../../src/registry/storage.concurrent.ts), consistent with the symlink-safety lesson in [decision-log #36](../../decision-log.md).
- **Allocation type alias.** `Allocation` is a type alias of `RegistryEntry` ([src/allocator/allocate.ts:12](../../../src/allocator/allocate.ts)), so registry entries feed `buildEnvMap` directly with no adaptation.

### The `PanelSnapshot` contract

The single typed payload of `GET /api/allocations`, defined in `src/panel/types.ts` and consumed by both the server and the frontend. Three nesting levels mirror the grouping (project → worktree → service):

```typescript
/**
 * A resolved discovery-env entry: an env-var name and the URL it expands to.
 * `links` only ever contains URLs with a safe browser-openable scheme
 * (http/https/ws/wss); any other-scheme or unparseable discovery URL is
 * excluded at the enrich layer (the service falls back to its non-clickable
 * port chip). See the XSS-hardening rule in 01-server-and-api.md.
 */
export interface PanelLink {
  readonly envVar: string
  readonly url: string
}

/** Whether a port currently has a listener. 'unknown' is reserved for probe error/timeout. */
export type PanelLivenessStatus = 'live' | 'not-running' | 'unknown'

/** One service within a worktree: its config label, allocated port, and resolved links. */
export interface PanelService {
  readonly envVar: string
  readonly links: readonly PanelLink[]
  readonly name: string
  readonly port: number
  readonly status: PanelLivenessStatus
}

/**
 * One worktree (namespace) under a project. `degraded` is true when the
 * worktree's config is missing/invalid or its directory is gone; in that case
 * `services` is rebuilt from raw registry ports (no links, name === envVar
 * unavailable) and `degradedReason` explains why.
 */
export interface PanelWorktree {
  readonly degraded: boolean
  readonly degradedReason: null | string
  readonly lastUsedAt: string
  readonly namespace: string
  readonly services: readonly PanelService[]
  readonly worktreeRoot: string
}

/** One project, keyed by git common dir. `label` is the explicit config `projectName` when set, else a name derived from `gitCommonDir` ('(no repo)' when null). */
export interface PanelProject {
  readonly gitCommonDir: null | string
  readonly label: string
  readonly worktrees: readonly PanelWorktree[]
}

/** The whole machine view. `generatedAt` is when this snapshot was built. */
export interface PanelSnapshot {
  readonly generatedAt: string
  readonly projects: readonly PanelProject[]
}
```

Field-by-field rationale and the degraded-entry construction rules live in [01-server-and-api.md](./01-server-and-api.md). The shape is deterministic (projects sorted by `label`, worktrees by `namespace`, services in config order; degraded services by `envVar`) so the JSON is stable across requests for an unchanged registry — same determinism contract `show` commits to.

## Acceptance criteria (consolidated)

Each item is independently verifiable and names the test (or `dev-workflow` step) that proves it. Per-layer ACs are duplicated into their sub-specs; this is the authoritative roll-up.

### CLI + server (01)

- [ ] `src/cli/panel.ts` exports `runPanel(options)` returning `Promise<Result<PanelOutcome, PortweaveError>>` with `PanelOutcome = { exitCode: number }`, callable from tests with injected `cwd`/`env`/`stdout`/`stderr` and a way to stop the server (injected `AbortSignal` or returned handle). Verified by `src/cli/__tests__/panel.test.ts`.
- [ ] `src/cli/panel.ts` exports `registerPanelCommand(program)` wiring the `panel` subcommand and its `--port <n>` option onto a commander root, mirroring `registerShowCommand`. Verified by a type-level / duck-typed-stub check in `panel.test.ts` (same pattern as [show.test.ts:408-427](../../../src/cli/__tests__/show.test.ts)).
- [ ] The server binds **`127.0.0.1` only** (never `0.0.0.0`), and prints its URL (`http://127.0.0.1:<port>/`) to stderr on start. Verified by `src/panel/__tests__/server.test.ts` booting on port `0` and asserting `server.address()` host + the stderr line.
- [ ] `GET /api/allocations` returns `Content-Type: application/json` and a body that parses to a `PanelSnapshot` with the exact top-level keys `generatedAt`, `projects`. Verified by `src/panel/__tests__/server.test.ts`.
- [ ] With several seeded worktree entries across ≥2 projects, the snapshot groups them project → worktree → service, with projects sorted by `label`, worktrees by `namespace`. Verified by `src/panel/__tests__/enrich.test.ts`.
- [ ] A new optional `projectName` field on the config schema (`src/config/schema.ts`) is accepted and normalized onto `Config` (`projectName?: string`); a non-empty string round-trips (trimmed), an empty/whitespace/non-string value is `CONFIG_INVALID` (`PW0102`), and configs without it still validate. Verified by `src/config/__tests__/schema.test.ts`.
- [ ] `PanelProject.label` is the explicit `projectName` when a worktree in the bucket sets it (tiebreak: the `main`-namespace config, else the first by namespace order with a non-empty value), else the derived `gitCommonDir` basename, else `'(no repo)'`. Verified by `src/panel/__tests__/enrich.test.ts`.
- [ ] Each service with a resolvable `discoveryEnv` template exposes one `PanelLink` per discovery key with the URL `buildEnvMap` produced; a service whose config declares no `discoveryEnv` exposes `links: []` (frontend renders a non-clickable port chip). Verified by `src/panel/__tests__/enrich.test.ts`.
- [ ] **Graceful degradation:** a seeded entry whose `worktreeRoot` does not exist, or whose `portweave.config.json` is missing/invalid, still appears in the snapshot with `degraded: true`, a non-null `degradedReason`, and `services` rebuilt from raw registry ports. One broken entry never throws out of `enrich`. Verified by `src/panel/__tests__/enrich.test.ts` (deleted-dir, missing-config, and invalid-config cases) and an integration case in `server.test.ts` mixing one healthy + one degraded entry.
- [ ] **Liveness:** `src/panel/liveness.ts` exports a connect-with-timeout probe that returns `'live'` for a port with a listener, `'not-running'` for a free port, within the configured timeout (~250 ms). Probes run in parallel across all ports of a request. Verified by `src/panel/__tests__/liveness.test.ts` (bind a real `net` server → `'live'`; unused port → `'not-running'`; assert wall-clock for N ports ≈ one timeout, not N×timeout).
- [ ] **Read-only:** the panel reads via the non-pruning `readRegistryEntries` (not `withRegistry`) and performs **zero** registry writes. After any number of `GET /api/allocations` requests, the on-disk registry file is byte-identical to the seed (no `lastUsedAt` change, no add/remove) **even when a deleted-dir (stale) entry is present** — which `withRegistry` would prune and rewrite. Verified by `src/panel/__tests__/server.test.ts` capturing the registry file bytes before/after N requests (with a stale entry seeded) and asserting byte-identical.
- [ ] **Empty registry:** with no entries, `GET /api/allocations` returns `{ generatedAt, projects: [] }` (HTTP 200), not an error. Verified by `src/panel/__tests__/server.test.ts`.
- [ ] **Clean shutdown:** firing the injected abort/stop causes `runPanel` to resolve with `exitCode: 0` and the server's port to be free afterward (a follow-up bind succeeds). Verified by `src/cli/__tests__/panel.test.ts`.
- [ ] **Port-in-use:** when the chosen port is already bound, `runPanel` writes a clear `[portweave] error: ...` line naming the port and returns `exitCode: 1` — no auto-retry. Verified by `src/cli/__tests__/panel.test.ts` (pre-bind the port, then `runPanel`).
- [ ] A new PW error code for the port-in-use case is added to `PW_ERROR_CODES` ([src/errors.ts](../../../src/errors.ts)) in the CLI block `PW06xx`. **Next free slot is `PW0604`** (`PW0601`–`PW0603` are taken: `CLI_INVALID_FLAGS`, `CLI_CHILD_SPAWN_FAILED`, `CLI_NO_ALLOCATION`). Proposed name `CLI_PANEL_PORT_IN_USE = 'PW0604'`; final number reconciles with whatever is actually free at implementation time per [decision-log #17](../../decision-log.md) (never renumber a published code). Verified by `panel.test.ts` asserting the code on the error.

### Frontend (02)

- [ ] `panel/` is a standalone Vite + React + TS app with its own `package.json`, `tsconfig.json`, and `node_modules` — none of React/Vite appears in the **root** `package.json` `dependencies`. Verified by [03](./03-build-and-tooling.md)'s no-runtime-dep AC.
- [ ] `vite build` in `panel/` (with `base: './'`) emits `index.html` + hashed assets into repo-root `dist/panel/`, referenced with relative paths so they load when served from the http server's static route. Verified manually + by the root-`build` AC in [03](./03-build-and-tooling.md).
- [ ] The UI fetches `/api/allocations` on mount and on a manual **Refresh** button click; no auto-poll/WebSocket/SSE. Renders the grouped snapshot, clickable links (services with `links`), non-clickable port chips (services without), liveness badges (`live` / `not running`), a degraded marker on degraded worktrees, and a clear empty state when `projects` is `[]`. Verified by manual smoke (frontend unit tests are out of POC scope — deferred to `panel/`'s own vitest per the [feature doc](../../features/management-panel/management-panel.md)).
- [ ] Dark theme via plain CSS variables (GitHub-dark palette), no UI kit dependency. Verified by inspecting `panel/` source (no component-library import).

### Build + tooling (03)

- [ ] Root `npm run build` runs the backend `tsc` build then `vite build` in `panel/`, producing both `dist/cli.js` (+ backend) and `dist/panel/`. Verified by running `npm run build` and asserting both outputs exist.
- [ ] **No new runtime dependency:** root `package.json` `dependencies` remains exactly `commander` + `zod` after this feature. Verified by `dev-workflow`'s `deadcode:check` (knip) plus a diff check on `package.json` `dependencies`.
- [ ] The published artifact carries the static UI: `files: ["dist/", ...]` already includes `dist/panel/` — **no `files` change needed** ([package.json:40-44](../../../package.json)). Verified by `npm pack --dry-run` listing `dist/panel/` entries after a build.
- [ ] `panel/**` is added to ESLint `ignores` ([eslint.config.ts:22-30](../../../eslint.config.ts)) so the frontend's JSX/TSX is not linted by the backend flat config (which would mis-resolve it against the backend `projectService`). Verified by `npm run lint` staying green with `panel/` present.
- [ ] `panel/**` is added to the `.jscpd.json` `ignore` list ([.jscpd.json](../../../.jscpd.json)) — jscpd's `format` already includes `tsx`/`css`, so without this the frontend would be duplication-scanned. Verified by `npm run dupcheck` staying green with `panel/` present.
- [ ] `knip`, `structure:check`, root `tsc` (`tsconfig.build.json` + `tsconfig.json`), and root `vitest` remain unaffected: their globs are already scoped to `src`/`scripts`/`config` ([knip.json:3-4](../../../knip.json), [scripts/bin/structure-check.ts:8](../../../scripts/bin/structure-check.ts), [tsconfig.build.json:10-11](../../../tsconfig.build.json), [tsconfig.json:9](../../../tsconfig.json), [vitest.config.ts:10](../../../vitest.config.ts)). Verified by `dev-workflow` staying green.
- [ ] `panel/node_modules/` is gitignored. The existing `node_modules/` rule ([.gitignore:1](../../../.gitignore)) has no leading slash so it already matches at any depth; an explicit `panel/node_modules/` line MAY be added for clarity but is not strictly required. Verified by `git status` showing `panel/node_modules` untracked.
- [ ] `npm run dev-workflow` is green end to end: `format:check`, `lint`, `typecheck`, `dupcheck`, `similarity:check`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.

### Decision-log impact

These rows are appended to [.ai/decision-log.md](../../decision-log.md) **on ship** (`Status: shipped`) — not now. Captured here so they are not lost:

- **`PanelSnapshot` API contract.** `GET /api/allocations` returns `{ generatedAt, projects[] → worktrees[] → services[] }` with the field shapes in `src/panel/types.ts`. Fields are additive — never rename/remove an existing one without a breaking-change note. The shape is shared between `src/panel/types.ts` (backend, source of truth) and the `panel/` app; the duplication is intentional and pinned by the server contract test (see Open questions for the share mechanism decision).
- **Default panel port `7733`.** Recorded as a named constant (`DEFAULT_PANEL_PORT`) so `constants:check` does not flag a bare literal; overridable via `--port`. On `EADDRINUSE` the command errors and exits 1 (no auto-retry). If the chosen value ever needs to change, do it before the panel has an installed base that has bookmarked it.
- **Liveness semantics = "something is listening," not "healthy."** A `'live'` badge means a TCP connect to `127.0.0.1:<port>` succeeded within ~250 ms; it does not assert the right service answered or that it is healthy. On-demand only (probed per request), never background-polled — preserving no-daemon.
- **Panel never writes the registry** (distinct from `show`, which touches). A future maintainer must not "fix" the perceived inconsistency by adding a `touch` to the panel's read path; mass-touching every worktree on every render would reset the recency signal stale-pruning depends on.
- **Panel reads via a new non-pruning `readRegistryEntries` (not `withRegistry`).** Rationale: it preserves the strict read-only invariant (no lock, no prune, no write) and lets the panel show deleted-dir worktrees as `degraded: 'directory deleted'`. `withRegistry`'s prune-and-rewrite-on-read is correct for `show` (a single-worktree read) but unacceptable for a read-only multi-worktree viewer — it would both rewrite the file on a mere read and silently drop the very entries the panel exists to surface.
- **New optional config field `projectName`.** Added to the config schema (`src/config/schema.ts`) as an optional display label the panel uses for project grouping, falling back to a `gitCommonDir`-derived name when unset. Additive and backward-compatible (existing configs and the Gameweave parity fixtures are unaffected); the `PORTWEAVE_` reserved-prefix rules do not apply (it is a display string, not an env var).
- **Panel link URLs are scheme-allowlisted (http/https/ws/wss) at the enrich layer + guarded in the frontend `href` — XSS hardening from the security review; the `discoveryEnv` schema is intentionally left permissive (ws/postgres/etc. are valid env values), so the clickable-link filter lives in the panel, not the schema.**

## Open questions

**None blocking** — all four were resolved during spec completion (2026-06-05):

- **`PanelSnapshot` type sharing → decided: duplicate-pinned-by-test.** The frontend re-declares a structurally identical `PanelSnapshot`; a backend contract test asserts the served JSON matches the shape. Build-time generation remains a possible later optimization, out of scope for the POC. Detail in [02](./02-frontend.md).
- **Liveness timeout → decided: fixed `LIVENESS_TIMEOUT_MS = 250`**, not user-tunable for the POC; revisit only if real usage shows false `not-running` on slow-to-accept services. Detail in [01](./01-server-and-api.md).
- **Project label → decided: add an optional `projectName` config field** (explicit label wins, else derived from `gitCommonDir`, else `'(no repo)'`). Detail in [01](./01-server-and-api.md).
- **PW error-code → confirmed `CLI_PANEL_PORT_IN_USE = 'PW0604'`** (the next free CLI slot; `PW0601`–`PW0603` are taken). Never renumbered once published, per [decision-log #17](../../decision-log.md).

One non-blocking implementer note remains in [01](./01-server-and-api.md): confirm the exact relative offset for resolving the bundled `dist/panel/` directory against the built tree during implementation.
