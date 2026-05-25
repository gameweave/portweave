# portweave/runtime library API

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/library-runtime/library-runtime.md](../../features/library-runtime/library-runtime.md)
**Decision-log rows:** [#6](../../decision-log.md) (JS library API deferred — this spec **overturns** that decision and ratifies the API into v0), [#17](../../decision-log.md) (PW error-code numbering — this feature opens the `PW07xx` library-runtime block), [#18](../../decision-log.md) (`.ts` import-extension policy — relevant for the ESM `exports` mapping that this spec adds)

## Problem

Vite, Next, and Vitest config files evaluate their JS/TS at config-load time — _before_ any `portweave run` wrapper child has a chance to inject env vars or write `.portweave/current.env`. That timing mismatch is the load-bearing reason §6.4 of [DESIGN.md](../../DESIGN.md) flagged the JS library API as something that might need to come forward into v0 despite [decision-log row #6](../../decision-log.md) deferring it.

For a fresh Vite project, the canonical pattern is roughly:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { ports } from 'portweave/runtime'

const allocated = await ports()
if (!allocated.ok) throw allocated.error
export default defineConfig({ server: { port: allocated.value.vite } })
```

Without an in-process library entry, the user has three bad options: (1) source `.portweave/current.env` into their shell before running `vite` (works, but breaks IDE "Run" and CI), (2) hard-code ports (loses every guarantee Portweave provides), (3) write a wrapper script that runs `portweave run -- vite` and forfeit the dev-server flag ergonomics they expect. None of these match the "user installs portweave and it just works" story [DESIGN.md §6.4](../../DESIGN.md) wants v0 to deliver.

The fix is small in surface area but architecturally meaningful: expose the same allocator + env-resolution path the CLI uses under a `portweave/runtime` subpath export. The library does not duplicate logic — it is a thin facade that resolves the allocation key from `process.cwd()`, loads the config, calls [allocate](../port-allocator/port-allocator.md), calls [resolveEnv](../env-resolution/env-resolution.md), and returns the result. Two simultaneous in-process callers serialize correctly because they both flow through the same `withRegistry` lock as the CLI ([registry-storage spec](../registry-storage/registry-storage.md)).

This spec ratifies the library API into v0 and overturns [decision-log row #6](../../decision-log.md). The overturn is justified because the cost is small (the facade is ~80 lines plus tests; no new coordination primitives needed) and the DX gap closed is genuinely load-bearing for the JS audience.

## Approach

One source file plus a tests directory under `src/runtime/`, plus a minimal additive change to `package.json`'s `exports` field. The library imports only from `src/config/`, `src/worktree/`, `src/allocator/`, and `src/env/` — it does **not** import from `src/cli.ts` or `src/cli/`. That dependency direction keeps the library decoupled from the CLI surface (the CLI may grow flags, banners, color output, etc.; the library remains a clean programmatic API).

### Public surface and types

```typescript
import type { Allocation } from '../allocator/allocate.ts'
import type { PortweaveError } from '../errors.ts'
import type { Result } from '../result.ts'

export interface PortsOptions {
  /** Working directory used for worktree-key resolution and config discovery. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** Explicit config path; bypasses upward-walk discovery. Resolved against `cwd` if relative. */
  readonly configPath?: string
  /** Anonymous-mode fallback. If no `portweave.config.json` is found AND `count` is provided, synthesize a config with N services (`PORT_1`..`PORT_N`). */
  readonly count?: number
}

export async function ports(
  opts?: PortsOptions,
): Promise<Result<Record<string, number>, PortweaveError>>

export async function env(
  opts?: PortsOptions,
): Promise<Result<Record<string, string>, PortweaveError>>

export async function allocation(
  opts?: PortsOptions,
): Promise<Result<Allocation, PortweaveError>>
```

All three return `Result`-wrapped values. The Vite config example in §Problem above shows the canonical consumption pattern: `if (!result.ok) throw result.error`, then `.value`. Throwing from the caller's config file is appropriate for an allocation failure — there is no recoverable path at config-eval time. A future helper (`unwrap` / `unwrapOr`) can be added if the manual `.ok` check becomes painful in practice, but at v0 the surface is intentionally narrow.

Why three functions and not one? `ports()`, `env()`, and `allocation()` are different shapes for different consumer needs:

- `ports()` returns `Record<string, number>` — the map a Vite config wants for `server.port` directly. Most common case.
- `env()` returns `Record<string, string>` — the resolved env-var map (allocated ports plus discovery URLs plus any `.env` overrides). Equivalent to what `portweave run` would inject into the child. Useful when the consumer wants to forward a known env-var name (e.g. `VITE_API_URL`) into a SDK at runtime.
- `allocation()` returns the full [Allocation](../port-allocator/port-allocator.md) (= `RegistryEntry`) including the key, namespace, ports map, and `lastUsedAt`. Useful for diagnostics, logging, or building higher-level helpers on top.

All three are async — Node's `fs` locking is async-only, [Vite supports async default exports for config files](https://vitejs.dev/config/), and the registry lock acquisition inside `withRegistry` is a `Promise`. Trying to expose a sync surface would either require a blocking sync filesystem path (deadlock-prone, no `fs.mkdir(...)` sync equivalent for the lock primitive) or `deasync`-class hacks. Async is the correct shape — this also aligns with the open question in the feature doc recommending async.

### `src/runtime/index.ts` — public composition

Single file. Each public function is a thin specialization of a shared `resolve(opts)` helper that does the full pipeline once and returns the data each function needs. Sketch:

```typescript
import { resolve as resolvePath } from 'node:path'
import { allocate } from '../allocator/allocate.ts'
import { loadConfig, synthesizeAnonymousConfig } from '../config/index.ts'
import { resolveEnv } from '../env/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import type { Config } from '../config/index.ts'
import { err, ok, type Result } from '../result.ts'
import { resolveAllocationKey } from '../worktree/key.ts'
import type { Allocation } from '../allocator/allocate.ts'

interface RuntimeOutcome {
  readonly allocation: Allocation
  readonly env: Readonly<Record<string, string>>
  readonly ports: Readonly<Record<string, number>>
}

async function resolveRuntime(
  opts?: PortsOptions,
): Promise<Result<RuntimeOutcome, PortweaveError>> {
  const cwd = resolvePath(opts?.cwd ?? process.cwd())

  const keyResult = resolveAllocationKey(cwd)
  if (!keyResult.ok) return keyResult
  const key = keyResult.value

  const configResult = await resolveConfigForRuntime(cwd, opts)
  if (!configResult.ok) return configResult
  const { config, projectRoot } = configResult.value

  const allocResult = await allocate(key, config)
  if (!allocResult.ok) return allocResult

  const envResult = await resolveEnv(
    allocResult.value.allocation,
    config,
    projectRoot,
  )
  if (!envResult.ok) return envResult

  return ok({
    allocation: allocResult.value.allocation,
    env: envResult.value.env,
    ports: allocResult.value.allocation.ports,
  })
}
```

`ports()`, `env()`, and `allocation()` each call `resolveRuntime(opts)` and project out their respective slice of the result. The full pipeline runs on every call; there is no in-process caching at v0 (see §Decision-log impact for the slot reserved for future cached-state work).

### `resolveConfigForRuntime` — upward-walk discovery + anonymous fallback

The CLI's `loadConfig(cwd, opts)` reads from exactly the directory passed in. The library cannot assume the user has invoked it from the project root — Vite config files are often re-evaluated from subdirectories during HMR, and Vitest workers can run from arbitrary cwds. The library must walk up from `cwd` to find the nearest `portweave.config.json`, the same way the CLI's `portweave run` invocation will (when that spec lands).

```typescript
async function resolveConfigForRuntime(
  cwd: string,
  opts: PortsOptions | undefined,
): Promise<Result<{ config: Config; projectRoot: string }, PortweaveError>> {
  // Explicit path wins — no walking.
  if (opts?.configPath !== undefined) {
    const loaded = await loadConfig(cwd, { configPath: opts.configPath })
    if (!loaded.ok) return loaded
    const projectRoot = dirname(resolvePath(cwd, opts.configPath))
    return ok({ config: loaded.value, projectRoot })
  }

  // Upward walk: cwd, parent, parent.parent, ... up to filesystem root.
  const found = await findConfigUpward(cwd)
  if (found !== null) {
    const loaded = await loadConfig(found.dir, {
      configPath: 'portweave.config.json',
    })
    if (!loaded.ok) return loaded
    return ok({ config: loaded.value, projectRoot: found.dir })
  }

  // No config file. Anonymous fallback if `count` is provided.
  if (opts?.count !== undefined) {
    const anon = synthesizeAnonymousConfig(opts.count)
    if (!anon.ok) return anon
    return ok({ config: anon.value, projectRoot: cwd })
  }

  // Neither config file nor `count` — typed error.
  return err(
    new PortweaveError(
      PW_ERROR_CODES.RUNTIME_CONFIG_NOT_FOUND,
      `no portweave.config.json found by walking up from ${cwd}, and no { count } option was provided`,
    ),
  )
}
```

The `findConfigUpward(start)` helper walks from `start` toward the filesystem root via `dirname`, checking `<dir>/portweave.config.json` at each step with `fs.access`. Stops at the first hit. Bounded by `path.parse(start).root`. Pure I/O, no caching. Lives in the same file as `resolveConfigForRuntime` — it's a 15-line helper.

The chosen `projectRoot` matches DESIGN.md §5.4's keying intent: when a config file is found, `projectRoot` is the directory containing it (so `.portweave/current.env` lands next to the config). When falling back to anonymous mode, `projectRoot` is the caller-supplied `cwd` — anonymous mode has no anchor, so the caller's cwd is the closest thing. This matches what `portweave run --count N` would do at the same `cwd`.

### Concurrency: rely on the registry lock, do not add an in-process mutex

Two simultaneous in-process callers (rare but real — e.g. parallel Vitest workers in the same Node process, or a Vite plugin that calls `ports()` from multiple module loads) serialize correctly because they both go through `withRegistry` inside `allocate()`. The registry lock is a directory mutex acquired via `fs.mkdir`; two callers in the same process race on `mkdir` just like two callers in different processes do, and the second one waits-and-retries per the registry-storage retry budget.

This means **no separate in-process mutex** is added at the runtime layer. Adding one would be redundant (the registry lock is the authoritative serialization point) and would mask races that need to surface — if the registry lock is misconfigured, an in-process mutex would hide the failure mode in tests that run inside a single process.

The acceptance criteria require an integration test that runs two `await ports()` calls in parallel within the same process and asserts they observe the same final allocation (no torn allocations, no doubled-up entries in the registry).

### Side-effect contract

The library writes `.portweave/current.env` on every successful call. This is enforced because `resolveEnv` (called inside `resolveRuntime`) unconditionally calls `atomicWriteDotenv` per the [env-resolution spec](../env-resolution/env-resolution.md). This satisfies the "two consumption modes from one code path" promise in [DESIGN.md §5.2](../../DESIGN.md) — invoking `await ports()` from a Vite config produces the same side effect as `portweave run` would.

The side effect is documented behavior, not an implementation detail. Acceptance criteria assert the file exists after a successful call.

### Error handling

Every public function returns `Result<T, PortweaveError>`. Possible error codes that can surface to the caller:

| Code     | Source                                                      | When                                                                                                                 |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PW0101` | [config-loader](../config-loader/config-loader.md)          | Explicit `configPath` was passed but the file does not exist                                                         |
| `PW0102` | [config-loader](../config-loader/config-loader.md)          | Config file exists but fails schema validation                                                                       |
| `PW0201` | [worktree-context](../worktree-context/worktree-context.md) | (Reserved — not currently surfaced because `resolveAllocationKey` falls back to absolute cwd on non-git directories) |
| `PW0202` | [worktree-context](../worktree-context/worktree-context.md) | `PORTWEAVE_OFFSET` set to a non-integer or out-of-range value                                                        |
| `PW0301` | [registry-storage](../registry-storage/registry-storage.md) | Lock contention exceeded the retry budget                                                                            |
| `PW0302` | [registry-storage](../registry-storage/registry-storage.md) | Registry file on disk is corrupt                                                                                     |
| `PW0401` | [port-allocator](../port-allocator/port-allocator.md)       | No free contiguous block in the configured pool range                                                                |
| `PW0501` | [env-resolution](../env-resolution/env-resolution.md)       | Allocation/config drift (should be unreachable in practice)                                                          |
| `PW0502` | [env-resolution](../env-resolution/env-resolution.md)       | Project-root `.env` has malformed lines                                                                              |
| `PW0701` | This spec                                                   | No `portweave.config.json` found by walking up AND no `count` option provided                                        |
| `PW0702` | This spec                                                   | (Reserved — see §New PW error codes below)                                                                           |

The library does not transform or wrap upstream errors — they pass through unchanged. The caller sees the underlying `PortweaveError` with its original `code` and `message`, which means error handling at the call site can be specific (`if (result.error.code === PW_ERROR_CODES.ALLOCATION_EXHAUSTED) ...`).

### New PW error codes

Two new codes seeded by this feature (per [decision-log row #17](../../decision-log.md)'s "addition order within block, gaps fine"). Add both to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts) on `Status: in-progress`:

- `RUNTIME_CONFIG_NOT_FOUND = 'PW0701'` — no `portweave.config.json` found by walking up from `cwd` AND no `count` option passed. The typed error the library returns when there is genuinely no way to know what to allocate.
- `RUNTIME_NOT_INITIALIZED = 'PW0702'` — reserved for a future allocation-cached state failure (e.g. an in-process cache that's not yet populated when a sync introspection helper is added post-v0). Documented here so the slot is not silently reused for an unrelated error; the runtime does not emit this code at v0.

### `package.json` `exports` field update

The package currently exposes only the CLI binary via `bin`. There is no `main`, no `exports`, no `types` field. The minimum additive change to make `import { ports } from 'portweave/runtime'` resolve under both ESM consumers and TypeScript-aware tooling is:

```jsonc
{
  // Existing fields unchanged: name, version, description, license, private, type: "module", bin, files, scripts, deps, etc.
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts",
    },
    "./runtime": {
      "import": "./dist/runtime/index.js",
      "types": "./dist/runtime/index.d.ts",
    },
  },
}
```

Notes on the exports shape:

- `"type": "module"` is already set in `package.json`, so `./dist/*.js` is ESM. CommonJS consumers can `await import('portweave/runtime')` — there is no CJS build at v0. This matches the rest of the package's posture (the CLI is also ESM-only).
- `tsc --build` already emits to `dist/` (per [project-structure.md](../../../.claude/rules/project-structure.md)), so the `dist/runtime/index.js` and `dist/runtime/index.d.ts` paths exist automatically once `src/runtime/index.ts` lands and `npm run build` runs.
- Including a `"types"` condition under each subpath makes TypeScript consumers see the declarations without needing `paths`/`typesVersions` shims.
- The package also flips from `private: true` to either keeping `private` (if v0 is not published yet) or removing it. **At v0 this spec does not touch `private`** — that's a separate publication-readiness call. The `exports` field works locally and in test consumers regardless of `private`.

### Coordination with the parallel-drafted `run-command` spec

`package.json` is touched by both this spec (`exports`) and the parallel-drafted [run-command spec](../run-command/run-command.md) (`bin`). The two keys are non-overlapping, so the eventual integration merge should be a clean 3-way merge. If a conflict arises, prefer manual reconciliation — the keys are independent and both edits can be applied in any order.

The library runtime depends on the same upstream chain as `run-command` (config-loader → worktree-context → registry-storage → port-allocator → env-resolution) but does **not** depend on the CLI. `src/runtime/index.ts` imports only from `src/config/`, `src/worktree/`, `src/allocator/`, and `src/env/`. The library and the CLI are siblings on top of the same allocator+env-resolution stack, not parent/child.

This independence is important for the test layout: the runtime tests do not need a built CLI binary to verify their behavior, and the runtime can ship even if the `run-command` spec is still in progress.

### Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), tests live in `src/runtime/__tests__/`. Real I/O against `os.tmpdir()`-based fixture projects is preferred over mocks — the whole point of this layer is the real filesystem side effects.

- `src/runtime/__tests__/runtime.test.ts` — the primary suite:
  - `ports()` against a fixture project with a `portweave.config.json` at the project root returns a port map covering every service in the config.
  - `env()` against the same fixture returns a map containing every service's `envVar` plus every resolved `discoveryEnv` entry.
  - `allocation()` returns a full `Allocation` whose `ports` equals the result of `ports()` and whose `key.worktreeRoot` matches the fixture path.
  - Calling `ports()` from a subdirectory of the fixture project (i.e. `opts.cwd` set deep inside the tree) still finds the project's `portweave.config.json` via upward walk and returns the same allocation as calling from the project root.
  - Two parallel `await ports()` calls in the same process (via `Promise.all`) produce a single registry entry with no duplicates — verifies the registry lock serializes intra-process callers.
  - Explicit `opts.configPath` (relative) is resolved against `opts.cwd` and bypasses the upward walk.
  - Anonymous fallback: with no config file in the fixture directory and `opts.count = 3`, returns three ports under keys `port-1`, `port-2`, `port-3` (matching `synthesizeAnonymousConfig`'s service names) and writes `.portweave/current.env` containing `PORT_1`, `PORT_2`, `PORT_3`.
  - No-config-no-count returns `err(PortweaveError)` with `code === PW_ERROR_CODES.RUNTIME_CONFIG_NOT_FOUND` (`PW0701`).
  - On success, `.portweave/current.env` exists at `<projectRoot>/.portweave/current.env` and contains the same env-var values returned by `env()`.

- `src/runtime/__tests__/upward-walk.test.ts` — focused tests on `findConfigUpward`: a fixture with `portweave.config.json` at depth 0 is found from depths 0/1/2/3; a fixture with no config found at any depth returns `null`; the walk stops at the filesystem root (verified by passing a path on a separate temp tree with no config above it).

- **`src/runtime/__tests__/exports-smoke.test.ts`** — the load-bearing AC for the `exports` field. Runs `npm run build` (or `tsc --build` directly) in a `beforeAll` to ensure `dist/` is fresh, then:
  1. Creates a tiny consumer project in `os.tmpdir()` with its own `package.json` declaring a `file:` dependency on the portweave source tree.
  2. `npm install`s it (use `process.execPath` + an inline install command that doesn't actually traverse the network — `npm pack` + local install).
  3. Writes a `consumer.mjs` that does `import { ports } from 'portweave/runtime'` and `console.log` the result.
  4. Runs `node consumer.mjs` and asserts the import resolved and the function returned a successful result against a fixture config in the consumer project.
  5. Also writes a `consumer.ts` and verifies TypeScript can `tsc --noEmit` it against the published `types` condition (loads `dist/runtime/index.d.ts` from the installed package). This is the half of the AC that proves the `"types"` condition in `exports` works.

  This is the "verified via a smoke test that builds a tiny consumer" criterion from the feature doc. Its cost is real (it runs a real build, a real install, a real subprocess), so it lives in its own file and may be tagged for CI rather than every pre-commit run. Decision on test tagging is deferred to the executing agent; default is "runs as part of `npm test`" unless the runtime cost in CI is prohibitive.

- `src/runtime/__tests__/error-passthrough.test.ts` — invariants for the error handling table above:
  - Explicit `configPath` pointing at a nonexistent file returns `PW0101`.
  - `PORTWEAVE_OFFSET="not-a-number"` set on the env produces `PW0202` (verifies the worktree-context error passes through).
  - A pool-exhausted scenario (manually pre-populate the registry to fill the pool range) returns `PW0401` from the runtime call.

Coverage thresholds from `vitest.shared.ts` (80% across statements/branches/functions/lines) apply per [.claude/rules/testing.md](../../../.claude/rules/testing.md).

### Decision-log impact

Two new rows to append on `Status: shipped` (not on `draft` — only when implementation ratifies the choices):

- **Overturning row #6.** A dated row stating: "JS library import API ratified into v0 via Feature #9 (library-runtime). The Vite/Next/Vitest config-load-timing concern surfaced in [§6.4](../../DESIGN.md) was load-bearing enough to pull this forward; the implementation is a thin facade over the same allocator+env-resolution path the CLI uses, so the cost was small." The executing agent fills in today's date when shipping.
- **Upward-walk config discovery rule.** A row documenting that the library walks from `cwd` upward to the filesystem root to find `portweave.config.json`, stopping at the first hit. This is a runtime-layer decision (the CLI's `loadConfig` reads from a single directory); future maintainers should not have to re-derive why the runtime layer adds the walk.

## Acceptance criteria

- [ ] `src/runtime/index.ts` exports three async functions — `ports(opts?)`, `env(opts?)`, `allocation(opts?)` — each returning `Promise<Result<T, PortweaveError>>` per the type signatures in §Public surface, callable from a JS consumer without reaching into `src/config/`, `src/allocator/`, `src/env/`, `src/worktree/`, or `src/registry/` internals.
- [ ] The `PortsOptions` interface exposes exactly `cwd`, `configPath`, and `count` (all optional, readonly) at v0. No additional options accepted.
- [ ] `src/runtime/index.ts` imports only from `src/config/`, `src/worktree/`, `src/allocator/`, `src/env/`, `src/errors.ts`, and `src/result.ts`. It does **not** import from `src/cli.ts` or `src/cli/`. Verified by a static import-graph assertion (or `knip`/`deadcode:check` configuration), and by `src/runtime/__tests__/runtime.test.ts` running without the CLI being built.
- [ ] Calling `await ports({ cwd: fixtureProjectRoot })` against a fixture project containing a valid `portweave.config.json` returns `ok` with a `Record<string, number>` whose keys are exactly the service names in the config. Verified by `src/runtime/__tests__/runtime.test.ts`.
- [ ] Calling `await env({ cwd })` returns `ok` with a `Record<string, string>` whose keys include every service's `envVar` and every resolved `discoveryEnv` key. Values match what `resolveEnv` would have produced via the CLI path. Verified by `src/runtime/__tests__/runtime.test.ts`.
- [ ] Calling `await allocation({ cwd })` returns the full `Allocation` (= `RegistryEntry`) with `key.worktreeRoot` matching the resolved worktree root for `cwd`. Verified by `src/runtime/__tests__/runtime.test.ts`.
- [ ] Upward-walk config discovery: calling `await ports({ cwd: subdir })` where `subdir` is nested inside a project whose `portweave.config.json` lives at the project root succeeds and finds the config via upward walk. Verified by `src/runtime/__tests__/runtime.test.ts` and `src/runtime/__tests__/upward-walk.test.ts`.
- [ ] Upward walk stops at the filesystem root and returns `null` when no `portweave.config.json` is found at any ancestor. Verified by `src/runtime/__tests__/upward-walk.test.ts`.
- [ ] Explicit `opts.configPath` (relative) is resolved against `opts.cwd` and bypasses the upward walk. An explicit `configPath` pointing at a nonexistent file returns `err(PortweaveError)` with `code === PW_ERROR_CODES.CONFIG_MISSING` (`PW0101`). Verified by `src/runtime/__tests__/runtime.test.ts` and `error-passthrough.test.ts`.
- [ ] Anonymous-mode fallback: when no `portweave.config.json` exists anywhere up the tree AND `opts.count` is provided, the runtime synthesizes a config via `synthesizeAnonymousConfig(count)`, allocates ports for the synthetic services, and writes `.portweave/current.env` with `PORT_1`..`PORT_N`. Verified by `src/runtime/__tests__/runtime.test.ts`.
- [ ] No-config-no-count returns `err(PortweaveError)` with `code === PW_ERROR_CODES.RUNTIME_CONFIG_NOT_FOUND` (`PW0701`). Verified by `src/runtime/__tests__/runtime.test.ts`.
- [ ] Every successful runtime call writes `.portweave/current.env` at `<projectRoot>/.portweave/current.env` with the same env-var values returned by `env()`. The file is written atomically (via the env-resolution writer). Verified by `src/runtime/__tests__/runtime.test.ts`.
- [ ] Two parallel `await ports()` calls in the same process (via `Promise.all`) produce a single coherent registry entry — no duplicate entries, no torn writes, both calls observe the same `ports` map. Verified by `src/runtime/__tests__/runtime.test.ts`. The runtime does **not** add an in-process mutex; serialization is provided by the registry lock alone.
- [ ] **Upstream error pass-through**: `PW0101`, `PW0102`, `PW0202`, `PW0301`, `PW0302`, `PW0401`, `PW0501`, `PW0502` surface to the caller with their original `code` and `message` unchanged. Verified by `src/runtime/__tests__/error-passthrough.test.ts` for at least three representative codes (`PW0101`, `PW0202`, `PW0401`).
- [ ] **`package.json` `exports` field is added** with `"."` and `"./runtime"` subpaths, each declaring `"import"` and `"types"` conditions pointing at `./dist/...` paths. The change is purely additive — no existing `package.json` fields are removed or altered.
- [ ] **Exports smoke test passes**: an external consumer project that lists `portweave` as a dependency (via `npm pack` + local install) can `import { ports } from 'portweave/runtime'` from an ESM file, run `node consumer.mjs`, and observe a successful allocation. The same consumer's TypeScript file can `tsc --noEmit` against the published `dist/runtime/index.d.ts`. Verified by `src/runtime/__tests__/exports-smoke.test.ts`.
- [ ] Two new PW error codes are added to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts): `RUNTIME_CONFIG_NOT_FOUND = 'PW0701'` and `RUNTIME_NOT_INITIALIZED = 'PW0702'` (the latter is reserved; not emitted at v0). Both are added on `Status: in-progress`.
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across statements / branches / functions / lines) are met for every new source file under `src/runtime/`.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.
- [ ] **On `Status: shipped`, two decision-log rows are appended**: (a) a row overturning [decision-log row #6](../../decision-log.md) — "JS library import API ratified into v0 via Feature #9 (library-runtime). The Vite/Next/Vitest config-load-timing concern surfaced in §6.4 was load-bearing enough to pull this forward; the implementation is a thin facade over the same allocator+env-resolution path the CLI uses, so the cost was small." — and (b) a row documenting the upward-walk config discovery rule (walk from `cwd` to filesystem root, stop at first hit). Date both rows with the ship date.

## Open questions

- **Exports smoke-test cost in CI.** The smoke test in `exports-smoke.test.ts` runs a real `npm run build`, packs the tree, installs into a temp consumer, and runs a child Node process. On a developer machine this adds 10–20s to `npm test`; in CI the cost is larger because the cold install path is uncached. Two reasonable resolutions: (1) gate the smoke test behind a `RUN_SMOKE_TESTS=1` env var so it runs in CI only via a dedicated job, or (2) accept the cost in the default test suite because the AC is the canonical proof that the `exports` field works. Recommend (2) for now — the test is the most direct way to keep the `exports` field honest, and the cost is acceptable at v0 scale. Flagging in case approval prefers gating; if so, the AC remains the same but the test file moves behind an `env`-gated `describe.skipIf` guard.
- **Should the library expose an `unwrap` helper?** Consumers in Vite config files will routinely write `if (!result.ok) throw result.error; const p = result.value` — a small `unwrap` helper would shorten that to `const p = unwrap(await ports())`. The feature doc's API surface intentionally excludes helpers at v0 to keep the surface minimal. Recommend adding `unwrap` later if real-world consumer code demonstrates the ergonomic gap; do not pre-emptively add it now.
- **In-process allocation caching.** A future enhancement is caching the allocation in a module-level variable so a Vite plugin that calls `ports()` multiple times during a single dev session does not re-acquire the registry lock on every call. The `PW0702` `RUNTIME_NOT_INITIALIZED` slot is reserved for the failure mode that emerges from such a cache (an introspection helper that requires the cache to be warmed). At v0 the runtime is uncached — every call runs the full pipeline. This is correct for v0 because the lock acquisition cost is small (<10ms typical) and the failure mode of a stale cache (a different process invalidates the allocation between two cached `ports()` calls) is harder to reason about than the cost of re-running the pipeline. Flagging in case approval wants caching at v0; recommend deferring to a follow-up.
- **Vite-plugin convenience export.** A future `portweave/vite` subpath could ship a `vitePortweave()` plugin function that wires `ports()` into Vite's `defineConfig` automatically. This is explicitly out of scope per the feature doc ("Framework adapters (Vite plugin, Next plugin) — those are post-v0"). The current `exports` field design accommodates the addition cleanly: a future PR adds `"./vite"` alongside `"./runtime"`. Flagging only because the framing of this spec — "the library is a facade" — naturally invites the follow-up question.
