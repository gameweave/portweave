# panel — backend: CLI, HTTP server, enrichment, liveness

**Parent:** [management-panel.md](./management-panel.md) (index — Problem, consolidated AC, Open questions, Decision-log impact)

This sub-spec owns the backend: `src/cli/panel.ts`, `src/panel/server.ts`, `src/panel/enrich.ts`, `src/panel/liveness.ts`, `src/panel/types.ts`, and their tests. The `PanelSnapshot` type is defined in full in the [index](./management-panel.md#the-panelsnapshot-contract); this file specifies how each field is produced.

## `src/cli/panel.ts` — subcommand handler + commander registration

Mirrors the [show](../../../src/cli/show.ts) / [run](../../../src/cli/run.ts) pattern: a testable `runPanel(options)` plus a thin `registerPanelCommand(program)`. The one structural difference from `show`: `runPanel` is **long-lived** — it resolves only when the server shuts down — so the test harness needs a way to stop it.

```typescript
import type { Command } from 'commander'
import type { PortweaveError } from '../errors.ts'
import type { Result } from '../result.ts'

export const DEFAULT_PANEL_PORT = 7733 as const

export interface PanelOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  port?: number
  /** Test hook: when this fires, the server shuts down and runPanel resolves. */
  signal?: AbortSignal
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
}

export interface PanelOutcome {
  readonly exitCode: number
}

export async function runPanel(
  options: PanelOptions,
): Promise<Result<PanelOutcome, PortweaveError>>

export function registerPanelCommand(program: Command): void
```

`DEFAULT_PANEL_PORT` is a named constant (not a bare literal) so [`constants:check`](../../../scripts/bin/constants-check.ts) does not flag it (per the project's duplicate-literal policy). Value `7733` per the [index](./management-panel.md) decision-log-impact note.

### Orchestration inside `runPanel`

1. **Resolve inputs.** `cwd = options.cwd ?? process.cwd()`, `env = options.env ?? process.env`, `port = options.port ?? DEFAULT_PANEL_PORT`, streams default to `process.stdout`/`process.stderr`. (The panel does not need `resolveAllocationKey`/`loadConfig` up front — unlike `show`, it has no single "current worktree"; config is loaded per-entry inside `enrich`.)
2. **Start the server.** Call `startPanelServer({ env, port, signal: options.signal })` from `src/panel/server.ts` (below). It returns a `Result<RunningPanelServer, PortweaveError>` once the socket is listening (or `EADDRINUSE`).
3. **Port-in-use → exit 1.** If `startPanelServer` returns `err` with code `CLI_PANEL_PORT_IN_USE`, write `formatErrorLine(error.message, error.code)` ([src/cli/banner.ts:89](../../../src/cli/banner.ts)) to stderr and return `ok({ exitCode: 1 })`. **No auto-retry** — per [feature-doc open question #2](../../features/management-panel/management-panel.md) and the index decision.
4. **Announce.** Write `[portweave] panel: http://127.0.0.1:<port>/\n` and `[portweave] press Ctrl-C to stop\n` to stderr. (Diagnostics go to stderr, consistent with [decision-log #27](../../decision-log.md).)
5. **Block until shutdown.** `await server.closed` — a promise that resolves when the server has closed, triggered by `SIGINT`/`SIGTERM` (production) or `options.signal` abort (tests). Then return `ok({ exitCode: 0 })`.

`registerPanelCommand`:

```typescript
program
  .command('panel')
  .description(
    'Start a read-only web dashboard of all machine-wide allocations',
  )
  .option('--port <n>', 'port to bind the panel server (default 7733)')
  .action(async (opts: { port?: string }) => {
    const port = opts.port !== undefined ? Number(opts.port) : undefined
    const result = await runPanel({ port })
    if (!result.ok) {
      process.stderr.write(`[portweave] ${result.error.message}\n`)
      process.exit(1)
    }
    process.exit(result.value.exitCode)
  })
```

`--port` is parsed via `Number(...)` exactly as `run` parses `--count` ([src/cli/run.ts:242](../../../src/cli/run.ts)). A non-integer / out-of-range `--port` is `CLI_INVALID_FLAGS` (`PW0601`, [decision-log #28](../../decision-log.md)) — validated in `runPanel` step 1 with the same shape `validateFlags` uses in [run.ts:64-96](../../../src/cli/run.ts). Wiring into `src/cli.ts` (the `registerPanelCommand(program)` call alongside `registerRunCommand` and `registerShowCommand`, [src/cli.ts:24-26](../../../src/cli.ts)) is a one-line integration this spec performs.

## `src/panel/server.ts` — http server, routing, shutdown, static serving

A `node:http` server (no framework — keeps the [no-new-runtime-dep](./management-panel.md) guarantee). Binds `127.0.0.1` only.

```typescript
import type { PortweaveError } from '../errors.ts'
import type { Result } from '../result.ts'

export interface StartPanelServerOptions {
  env: NodeJS.ProcessEnv
  port: number
  signal?: AbortSignal
}

export interface RunningPanelServer {
  /** Resolves when the server has fully closed. */
  readonly closed: Promise<void>
  /** The actual bound port (useful when port 0 was requested in tests). */
  readonly port: number
}

export function startPanelServer(
  options: StartPanelServerOptions,
): Promise<Result<RunningPanelServer, PortweaveError>>
```

### Binding and the port-in-use path

`http.createServer(handler).listen(port, '127.0.0.1')`. The `'127.0.0.1'` host argument is mandatory — binding without it (or to `0.0.0.0`) would expose the panel beyond loopback, violating the [feature-doc](../../features/management-panel/management-panel.md) "loopback only" scope. The probe in [src/allocator/probe.ts:18-23](../../../src/allocator/probe.ts) is the precedent for the explicit `127.0.0.1` bind and the rationale comment.

`startPanelServer` returns a promise that resolves on the `'listening'` event with `ok({ closed, port: server.address().port })`. On the `'error'` event, if `err.code === 'EADDRINUSE'`, resolve `err(new PortweaveError(PW_ERROR_CODES.CLI_PANEL_PORT_IN_USE, \`panel port ${port} is already in use — pass --port <n> to choose another\`))`; any other listen error resolves as a generic `CLI_PANEL_PORT_IN_USE`-or-rethrow (an unexpected bind failure is rare; surface it rather than hang). `CLI_PANEL_PORT_IN_USE` is the new code (`PW0604` proposed, see [index AC](./management-panel.md#cli--server-01)).

### Route switch

A small `switch`/if-chain on `req.method + URL pathname`:

| Method + path          | Handler                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/allocations` | Build the snapshot (below) → `200`, `Content-Type: application/json`, `JSON.stringify(snapshot)`.                    |
| `GET /`                | Serve `dist/panel/index.html` (`text/html`).                                                                         |
| `GET /<asset>`         | Serve the matching file from `dist/panel/` (hashed JS/CSS, etc.) with a content-type from a tiny extension→MIME map. |
| anything else          | `404` plain text.                                                                                                    |

Only `GET` is accepted; any other method on any path is `405`. The panel exposes **no mutating routes** — there is nothing to POST/DELETE (the read-only contract, [index](./management-panel.md)).

### `GET /api/allocations` handler

```
1. snapshot = await buildPanelSnapshot(options.env)   // from enrich.ts — read-only registry read + per-entry enrich + liveness
2. write 200 + application/json + JSON.stringify(snapshot)
3. on any thrown error: 500 + {"error":"snapshot-failed"} (defensive; enrich itself never throws per its contract)
```

`buildPanelSnapshot` performs the single `readRegistryEntries` read, the per-entry `loadConfig` + `buildEnvMap`, the grouping, and the liveness probes. It lives in `enrich.ts` (pure-ish: the only I/O is the registry read, config reads, and TCP probes — all injectable for tests). Keeping it out of `server.ts` keeps the http layer thin and lets `enrich.test.ts` exercise the whole pipeline without a socket.

### Static asset serving (symlink-safe path)

Resolve the bundled UI directory relative to the compiled module, not `process.cwd()`:

```typescript
import { fileURLToPath } from 'node:url'
// dist/panel/server.js → ../../panel  (i.e. dist/panel/) at runtime after build
const PANEL_ASSET_DIR = fileURLToPath(new URL('../panel/', import.meta.url))
```

This is the [decision-log #36](../../decision-log.md) symlink-safety pattern (`import.meta.url`-based resolution), already used at [src/allocator/allocate.concurrent.ts:11-14](../../../src/allocator/allocate.concurrent.ts) and [src/registry/storage.concurrent.ts:11-14](../../../src/registry/storage.concurrent.ts). The exact relative offset (`../panel/`) depends on where the compiled `server.js` lands under `dist/` vs. where `dist/panel/` sits; the implementer confirms the offset against the built tree (`dist/panel/server.js` → `dist/panel/` static dir would be `./` ; if backend compiles to `dist/cli/...` and `dist/panel/...` the offset is computed from the actual layout). **Path-traversal guard:** every requested asset path is resolved and verified to stay inside `PANEL_ASSET_DIR` (reject `..` escapes) before reading — standard static-file hygiene even on a loopback server.

If `dist/panel/` is absent (e.g. backend built but `vite build` not yet run in a dev checkout), `GET /` returns a `503` with a one-line "panel UI not built — run npm run build" message rather than crashing. The `/api/allocations` route still works (useful for `curl`/tests without a built UI).

### Shutdown

`startPanelServer` wires clean teardown:

- `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` each call `server.close()` and resolve `closed`. (Same signal-handling shape as [src/cli/spawn.ts:54-78](../../../src/cli/spawn.ts), including removing the listeners on teardown so repeated `runPanel` calls in one test process do not leak handlers.)
- If `options.signal` is provided, an `'abort'` listener also triggers `server.close()` — this is the test stop hook.
- `server.close()` stops accepting connections; the `closed` promise resolves on the server `'close'` event. Idempotent: a second signal during close is a no-op.

## Config schema addition: `projectName`

The panel introduces one **optional** config field so a project can set a human-friendly panel label. This is the only change outside `src/panel/` + `src/cli/`.

`configFileSchema` is a `z.strictObject` ([src/config/schema.ts:41-44](../../../src/config/schema.ts)) — unknown top-level keys are rejected — so the field must be declared explicitly:

```typescript
const configFileSchema = z.strictObject({
  $schema: z.string().optional(),
  projectName: z.string().trim().min(1).max(100).optional(), // NEW — display label
  services: servicesMapSchema,
})
```

- Add `projectName?: string` to the `Config` interface ([src/config/schema.ts:57-62](../../../src/config/schema.ts)) and pass it through in `normalize()` with the same conditional-spread idiom used for `sourcePath` ([src/config/schema.ts:199-204](../../../src/config/schema.ts)): `...(raw.projectName !== undefined ? { projectName: raw.projectName } : {})`.
- **No** cross-field / reserved-prefix handling — `projectName` is a display string, not an env var, so the `RESERVED_ENV_PREFIX` and placeholder checks ([src/config/schema.ts:105-174](../../../src/config/schema.ts)) do not apply to it.
- `loadConfig` ([src/config/loader.ts:70](../../../src/config/loader.ts)) needs no change — it already delegates shape handling to `validateAndNormalizeConfig`.
- **Backward-compatible & parity-safe:** the field is optional, so every existing `portweave.config.json` (and the Gameweave parity fixtures) still validates unchanged. `run --count` (anonymous, no file) simply has no `projectName`, and the panel re-loads config from disk anyway, so anonymous allocations land on the degraded path and get a derived label.
- Implementer check: if a published config JSON-schema file ships for editor autocomplete, add `projectName` there too.

How the panel consumes it is the label-resolution step below.

## `src/panel/enrich.ts` — registry entries → `PanelSnapshot` (grouping + degradation)

The core transform. Exports `buildPanelSnapshot(env)` plus pure helpers for unit testing.

```typescript
import type { PanelSnapshot } from './types.ts'

export interface EnrichDeps {
  /** Injectable for tests; defaults to the real liveness probe. */
  probe?: (port: number) => Promise<PanelLivenessStatus>
}

export async function buildPanelSnapshot(
  env: NodeJS.ProcessEnv,
  deps?: EnrichDeps,
): Promise<PanelSnapshot>
```

### Pipeline

1. **Read all entries (read-only).** `await readRegistryEntries(env)` ([src/registry/storage.ts](../../../src/registry/storage.ts)) — a lock-free, non-pruning read primitive that loads the registry file and returns its entries as `Result<readonly RegistryEntry[], PortweaveError>` (missing registry → `ok([])`). It takes **no lock**, performs **no `mkdir`**, runs **no prune**, and **never writes** the file. This is the load-bearing read-only step (see [index](./management-panel.md)), and it is **why the panel can both stay genuinely read-only and surface deleted-dir worktrees as degraded**. Contrast `withRegistry` ([src/registry/storage.ts:91](../../../src/registry/storage.ts)), which calls `pruneStaleEntries` on every read ([src/registry/storage.ts:107](../../../src/registry/storage.ts)) and rewrites the file when that prune drops an entry ([src/registry/storage.ts:115](../../../src/registry/storage.ts)): for `show` (a single-worktree read) prune-on-read is correct, but for a multi-worktree read-only viewer it would (a) silently drop any entry whose `worktreeRoot` directory is gone — so the panel could never show a "directory deleted" worktree at all — and (b) rewrite the registry on a mere read, breaking the read-only invariant. `readRegistryEntries` avoids both. If it errors (corrupt file), `buildPanelSnapshot` surfaces it as a thrown error that the server's 500 path catches; a corrupt registry is an exceptional condition, not a per-entry degradation. `show` keeps using `withRegistry` — prune-on-read is the right behavior there.
2. **Enrich each entry → `PanelWorktree`.** For each `RegistryEntry`:
   - Attempt `loadConfig(entry.key.worktreeRoot)` ([src/config/loader.ts:70](../../../src/config/loader.ts)).
   - **Healthy path** (config loads): call `buildEnvMap(entry, config)` ([src/env/build.ts:7](../../../src/env/build.ts)) to resolve discovery URLs. For each `service` in `config.services` ([src/config/schema.ts:49-55](../../../src/config/schema.ts)): the port is `entry.ports[service.name]`; the `links` are one `PanelLink` per `service.discoveryEnv` key, with `url = envMap[discoveryKey]`. **Link URLs are scheme-allowlisted** to the safe browser-openable set `{http, https, ws, wss}`: each resolved `url` is parsed and only kept in `links` if its scheme is in that allowlist; any other scheme (e.g. `javascript:`, `data:`, `file:`, `postgres:`) or an unparseable URL is **excluded** — the service then has fewer (or zero) links and falls back to its non-clickable port chip. This is an **XSS-hardening** measure: the panel is machine-wide and renders links from repos the viewer may not own, so a `javascript:`/`data:` discovery URL would otherwise be a script-execution sink in a clickable `<a href>`. The `discoveryEnv` **config schema is intentionally not narrowed** (it legitimately allows `ws`/`postgres`/etc. for env injection); the clickable-link decision belongs at the panel layer, not the schema. A defense-in-depth `href` guard also lives in the frontend ([panel/src/components/ServiceRow.tsx](../../../panel/src/components/ServiceRow.tsx), [02-frontend.md](./02-frontend.md)). `degraded: false`, `degradedReason: null`.
   - **Degraded path** (config missing/invalid OR `worktreeRoot` does not exist OR `buildEnvMap` throws `ENV_BUILD_INVALID` on config/allocation drift, [src/env/build.ts:17-21](../../../src/env/build.ts)): rebuild `services` from **raw registry ports only** — one `PanelService` per `Object.entries(entry.ports)` with `name = serviceName`, `envVar = ''` (unknown without config), `links: []`, plus the liveness `status`. `degraded: true`, `degradedReason` ∈ a small enum of human strings (`'directory deleted'`, `'config missing'`, `'config invalid'`). **A degraded entry never throws** — `loadConfig` errors and `buildEnvMap` throws are both caught here and converted to the degraded shape, satisfying "one broken entry never breaks the page" ([feature doc](../../features/management-panel/management-panel.md)).
   - Directory-existence check uses `fs.access`/`existsSync` on `entry.key.worktreeRoot` (a deleted-dir worktree still has a registry entry but no config to load — `loadConfig` would return `CONFIG_MISSING`; the explicit existence check lets us label it `'directory deleted'` rather than the less-specific `'config missing'`).
3. **Liveness probe.** Collect every port across every (healthy + degraded) service and probe them **in parallel** via `Promise.all(ports.map(deps.probe ?? liveness.probePortAlive))`. Build a `Map<port, PanelLivenessStatus>` and stamp each `PanelService.status`. Parallelism keeps a page with M ports at ≈ one timeout, not M × timeout (asserted by [liveness.test.ts](#test-layout)).
4. **Group project → worktree.** Bucket `PanelWorktree`s by `entry.key.gitCommonDir`. Each bucket becomes a `PanelProject`:
   - `gitCommonDir`: the key (or `null`).
   - `label`: **explicit `projectName` wins, else derived.** If any worktree in the bucket has a loaded config with a non-empty `projectName`, use it — deterministic tiebreak across a repo's worktrees: prefer the `main`-namespace worktree's config, else the first worktree by namespace sort order that sets a non-empty `projectName`. Otherwise derive from `gitCommonDir`: `basename(dirname(gitCommonDir))` when the common dir ends in `.git`, else `basename(gitCommonDir)`. When `gitCommonDir === null`, the bucket label is the literal `'(no repo)'`. Degraded worktrees (no/invalid config) contribute no `projectName`, so a bucket whose every worktree is degraded falls back to the derived / `'(no repo)'` label. (Resolves [feature-doc open question #1](../../features/management-panel/management-panel.md); the field itself is specified above under "Config schema addition: `projectName`".)
5. **Sort for determinism.** Projects by `label` (ties broken by `gitCommonDir` string, `null` last); worktrees by `namespace`; healthy services in `config.services` order (config is authoritative for ordering, matching the [banner](../../../src/cli/banner.ts:53)); degraded services by `envVar`-less `name`. Stamp `generatedAt = new Date().toISOString()` and `PanelWorktree.lastUsedAt = entry.lastUsedAt`.

The whole transform returns `{ generatedAt, projects }`. It is deterministic for an unchanged registry (the same determinism contract `show`'s JSON commits to in [show-command spec](../show-command/show-command.md)).

## `src/panel/liveness.ts` — TCP connect-with-timeout probe

The inverse of [src/allocator/probe.ts](../../../src/allocator/probe.ts): instead of "can I bind?" ( = is it free?), the panel asks "can I connect?" ( = is something listening?).

```typescript
import type { PanelLivenessStatus } from './types.ts'

export const LIVENESS_TIMEOUT_MS = 250 as const

export function probePortAlive(
  port: number,
  timeoutMs?: number,
): Promise<PanelLivenessStatus>
```

Implementation: `net.connect({ host: '127.0.0.1', port })`; on `'connect'` → destroy socket, resolve `'live'`; on `'error'` (ECONNREFUSED etc.) → resolve `'not-running'`; on a `timeoutMs` timer (default `LIVENESS_TIMEOUT_MS`) → destroy, resolve `'not-running'` (a slow/unresponsive listener reads as not-running for POC; semantics are "something answered a TCP handshake quickly," not "healthy" — [feature-doc open question #3](../../features/management-panel/management-panel.md), [index decision](./management-panel.md#decision-log-impact)). `'unknown'` is reserved in the type for a future "probe errored in a way we can't classify" case; POC collapses everything non-`live` to `'not-running'`. `LIVENESS_TIMEOUT_MS` is a named constant for `constants:check`.

Bind `127.0.0.1` explicitly for the same reason `probe.ts` does — a service bound to a specific interface should be probed on loopback, and we must not accidentally probe a remote host.

## Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md): real I/O against `os.tmpdir()`, `XDG_CONFIG_HOME` override for registry isolation, servers booted on port `0`. Mirror the setup in [src/cli/**tests**/show.test.ts:72-103](../../../src/cli/__tests__/show.test.ts) (tempdir worktree, seeded registry via `withRegistry(h => h.upsert(entry), env)`, captured `Writable` streams).

### `src/config/__tests__/schema.test.ts` (extend existing)

0a. **`projectName` accepted.** A config with `projectName: 'My App'` validates and normalizes to `Config.projectName === 'My App'` (trimmed).
0b. **`projectName` optional.** A config without `projectName` validates; `Config.projectName` is `undefined` — guards backward-compat / parity.
0c. **`projectName` invalid.** Empty string, whitespace-only, or non-string `projectName` → `CONFIG_INVALID` (`PW0102`) with a clear message; an unknown sibling key still fails `strictObject` as before.

### `src/panel/__tests__/liveness.test.ts`

1. **Live port.** Bind a real `net` server on a tempdir-free port; `probePortAlive(port)` → `'live'`; close server.
2. **Not-running port.** Pick a port with no listener; `probePortAlive(port)` → `'not-running'`.
3. **Timeout is bounded.** Probe N (e.g. 20) not-running ports via `Promise.all`; assert total wall-clock < ~2× `LIVENESS_TIMEOUT_MS` (proves parallelism, not N×timeout).

### `src/panel/__tests__/enrich.test.ts`

4. **Grouping + sort.** Seed entries for 2 projects (distinct `gitCommonDir`), 2 worktrees each; inject a stub `probe` (all `'not-running'`) so the test is deterministic and fast. Assert `projects` sorted by `label`, `worktrees` sorted by `namespace`, services in config order.
   4a. **Label: explicit `projectName`.** Seed two worktrees in one `gitCommonDir` bucket whose configs set `projectName: 'My App'`; assert `PanelProject.label === 'My App'`.
   4b. **Label: tiebreak.** Seed a bucket where the `main`-namespace config sets `projectName: 'Main Name'` and a feature worktree sets `'Feature Name'`; assert the `main` value wins. With no `main` namespace present, assert the first by namespace sort order with a non-empty value wins.
   4c. **Label: derived fallback.** Seed a bucket whose configs set no `projectName`; assert `label` is the derived repo basename. With `gitCommonDir === null`, assert `label === '(no repo)'`. A bucket whose only worktree is degraded (no config) also falls back to the derived / `'(no repo)'` label.
5. **Healthy links.** Seed an entry with a config declaring `discoveryEnv` (e.g. `VITE_API_URL: 'http://localhost:${api}'`); assert the `PanelService.links` contains `{ envVar: 'VITE_API_URL', url: 'http://localhost:<allocated-api-port>' }` — the URL uses the allocated port per [decision-log #26](../../decision-log.md).
6. **No-template service → empty links.** Seed a service with no `discoveryEnv`; assert `links: []`.
   6a. **Link scheme allowlist (XSS hardening).** Seed a service whose `discoveryEnv` resolves to a mix of schemes — `http`/`https`/`ws`/`wss` URLs **and** `javascript:`/`data:` (and an unparseable value); assert the `javascript:`/`data:`/unparseable URLs are **excluded** from `links` while the `http`/`https` (and `ws`/`wss`) ones are kept. Seed a separate service whose **only** discovery URL is unsafe (e.g. `javascript:alert(1)`) and assert `links: []` — it falls back to the non-clickable port chip. No `javascript:`/`data:` URL ever reaches a `PanelLink.url`.
7. **Degraded: missing config.** Seed an entry whose `worktreeRoot` exists but has no `portweave.config.json`; assert `degraded: true`, `degradedReason === 'config missing'`, services rebuilt from raw `entry.ports`, `links: []`, and **no throw**.
8. **Degraded: deleted directory.** Seed an entry whose `worktreeRoot` does not exist on disk; assert it still **appears** in the snapshot (it is not silently dropped — `readRegistryEntries` does not prune) with `degraded: true`, `degradedReason === 'directory deleted'`, raw-ports services.
9. **Degraded: invalid config.** Seed an entry whose `portweave.config.json` is malformed JSON; assert `degraded: true`, `degradedReason === 'config invalid'`.
10. **One broken among healthy.** Seed one healthy + one deleted-dir entry; assert both appear, the healthy one fully enriched, the broken one degraded — the page-survives-one-bad-entry guarantee.
11. **Read-only (even with a stale entry present).** Seed entries with a fixed `lastUsedAt`, **including a deleted-dir entry** (the kind `withRegistry` would prune-and-rewrite); capture the registry file's exact bytes; call `buildPanelSnapshot`; re-read the file and assert it is **byte-identical** to the capture (the stale entry is still present, no `lastUsedAt` change, no add/remove, no rewrite). This is the load-bearing read-only assertion — it proves the panel reads via `readRegistryEntries` and not `withRegistry`, since the latter would have pruned the deleted-dir entry and rewritten the file.

### `src/panel/__tests__/server.test.ts`

12. **Boots on 127.0.0.1.** `startPanelServer({ env, port: 0 })`; assert `server.address().address === '127.0.0.1'` (via the underlying handle or the returned `port` + a connect check); then close.
13. **`GET /api/allocations` shape.** Boot on port 0, seed ≥2 entries, `fetch('http://127.0.0.1:<port>/api/allocations')`; assert `Content-Type: application/json`, body parses to a `PanelSnapshot` with top-level keys exactly `['generatedAt', 'projects']`, and `projects` reflects the seed grouping.
14. **Empty registry.** No seed; assert `200` and `{ generatedAt, projects: [] }`.
15. **Mixed healthy + degraded over HTTP.** Seed one healthy + one deleted-dir entry; assert both present in the fetched snapshot with correct `degraded` flags (integration of enrich through the socket).
16. **Read-only over HTTP.** Seed entries including a deleted-dir (stale) entry; capture the registry file bytes, issue 3 `GET /api/allocations` requests, re-read; assert byte-identical (the stale entry survives, zero rewrites — confirms `readRegistryEntries` over the socket).
17. **405 / 404.** `POST /api/allocations` → `405`; `GET /nope` → `404`.
18. **Static fallback when unbuilt.** With `dist/panel/` absent (tests run pre-`vite build`), `GET /` → `503` with the "not built" message, while `GET /api/allocations` still `200`s. (Confirms tests do not depend on the frontend build.)

### `src/cli/__tests__/panel.test.ts`

19. **Clean shutdown via signal.** `const ac = new AbortController()`; start `runPanel({ port: 0, env, signal: ac.signal, stdout, stderr })`; once the announce line appears, `ac.abort()`; assert the promise resolves `ok({ exitCode: 0 })` and a subsequent bind on that port succeeds (port freed).
20. **Port-in-use → exit 1.** Pre-bind a port with a throwaway server; `runPanel({ port: <bound>, env, ... })`; assert `ok({ exitCode: 1 })`, the stderr line names the port, and (if surfaced) the error carries `CLI_PANEL_PORT_IN_USE`.
21. **Invalid `--port`.** `runPanel({ port: -1 })` (or `NaN`) → `exitCode: 1` with a `CLI_INVALID_FLAGS` diagnostic (mirrors [run.ts validateFlags](../../../src/cli/run.ts:64-96)).
22. **`registerPanelCommand` registration.** Duck-typed commander stub (same as [show.test.ts:408-427](../../../src/cli/__tests__/show.test.ts)) asserts `command('panel')` is registered and `option('--port ...')` is called.

Coverage thresholds (80% statements/branches/functions/lines, [vitest.shared.ts:18-23](../../../vitest.shared.ts)) apply to all new `src/panel/*.ts` and `src/cli/panel.ts`.

## Acceptance criteria (this layer)

See the [index roll-up](./management-panel.md#cli--server-01) — the CLI + server bullets there are authoritative and each names one of the tests above. Summary of the load-bearing ones:

- [ ] `runPanel` / `registerPanelCommand` exported with the signatures above; testable with injected `cwd`/`env`/`stdout`/`stderr`/`signal` (tests 19–22).
- [ ] Server binds `127.0.0.1` only and prints its URL to stderr (test 12 + announce-line assertion in 19).
- [ ] `GET /api/allocations` → `application/json` `PanelSnapshot` with keys `generatedAt`, `projects` (test 13); empty registry → `projects: []` (test 14).
- [ ] Grouping project → worktree → service with deterministic sort; healthy links use the allocated port; no-template services get `links: []` (tests 4–6).
- [ ] Link URLs are scheme-allowlisted to `{http, https, ws, wss}` (XSS hardening): a discovery URL resolving to `javascript:`/`data:` (or any other scheme, or unparseable) is excluded from `links` so no such URL ever reaches a clickable `href`; a service whose only discovery URL is unsafe gets `links: []` and falls back to the port chip. The `discoveryEnv` schema is intentionally left permissive. Verified by `enrich.test.ts` (test 6a).
- [ ] Optional `projectName` config field added to the schema (strictObject), normalized onto `Config`; accepted when non-empty (trimmed), rejected when empty/non-string, absent in existing configs (tests 0a–0c).
- [ ] `PanelProject.label` uses explicit `projectName` (with the `main`-first tiebreak), else the derived `gitCommonDir` basename, else `'(no repo)'` (tests 4a–4c).
- [ ] Graceful degradation for deleted-dir / missing-config / invalid-config; one broken entry never throws (tests 7–10, 15).
- [ ] Liveness connect-probe: `live` for a listener, `not-running` for a free port, parallel and bounded by ~250 ms (tests 1–3).
- [ ] Read-only: the panel reads via the non-pruning `readRegistryEntries` (not `withRegistry`) and performs **zero** registry writes — the on-disk file is byte-identical before/after requests **even when a deleted-dir (stale) entry is present** (which `withRegistry` would prune-and-rewrite), verified by a before/after byte-identical check (tests 11, 16).
- [ ] Clean SIGINT/SIGTERM/abort shutdown frees the port; `runPanel` resolves `exitCode: 0` (test 19).
- [ ] Port-in-use errors and exits 1, no auto-retry; new code `CLI_PANEL_PORT_IN_USE` in `PW06xx` (`PW0604` proposed) (test 20).
