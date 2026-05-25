# portweave show — read-only allocation introspection

**Status:** approved
**Owner:** TBD
**Feature doc:** [.ai/features/show-command/show-command.md](../../features/show-command/show-command.md)
**Decision-log rows:** [#5](../../decision-log.md) (wrapper writes `.portweave/current.env` — show must _not_), [#17](../../decision-log.md) (PW error-code numbering — this spec opens one slot in the CLI block `PW06xx`)

## Problem

Once `portweave run` has claimed a block of ports for a worktree, developers need a way to ask "what did I get?" without spawning anything ([DESIGN.md §5.2](../../DESIGN.md)). The motivating moments are routine: a teammate asks for the API URL, an agent verification loop wants the same ports the running dev server claimed, or a developer wants to confirm an allocation before debugging further. Without `portweave show` the only recovery paths are reading `.portweave/current.env` (which may not exist if no `run` has executed in this shell session), opening the machine-wide registry by hand, or re-running `run` and re-reading the banner — wasteful and unsafe if the existing servers are bound to those ports.

`show` makes the allocation a first-class queryable value with three load-bearing properties (per the [feature doc](../../features/show-command/show-command.md)):

1. **Read-only.** Never claims, never probes, never writes `.portweave/current.env`. The only acceptable observable effect is the `lastUsedAt` recency bump (`handle.touch` from [src/registry/storage.ts:49](../../../src/registry/storage.ts)) so stale-pruning does not sweep up worktrees that are actively introspected.
2. **Same view as `run`.** The human banner format must be byte-identical to what `portweave run` would print for the same allocation — same shape, same column widths, same `[portweave]` prefix lines from [DESIGN.md Appendix B](../../DESIGN.md). The run-command spec owns the formatter at `src/cli/banner.ts`; this spec consumes it.
3. **`--json` for scripts.** Same data, machine-readable, single document on stdout. Shell wrappers, agent verification loops, and CI scripts pipe it into `jq`.

## Approach

One source file plus a tests directory under `src/cli/`. `show` is a thin orchestrator: resolve cwd → load config → look up the entry inside `withRegistry` → either print the banner (delegating to the shared formatter) or emit JSON → exit. The fallible business logic returns `Result<T, PortweaveError>`; only the final exit-code translation lives in the handler.

### Parallel-drafted dependency: `src/cli/banner.ts` (owned by the run-command spec)

The run-command spec ([sibling, drafting in parallel](../run-command/run-command.md)) introduces a banner formatter under `src/cli/banner.ts`. This spec assumes the contract:

```typescript
export function formatAllocationBanner(
  allocation: Allocation,
  config: Config,
  options?: { reused?: boolean; wroteEnvFile?: boolean; launching?: string },
): string
```

`show` calls this with `options = {}` so the lines that only apply to `run` (`wroteEnvFile`, `launching`) are omitted. If the run-command author lands a slightly different signature, the integration round adjusts this spec — the structural assumption is "the banner formatter is shared, lives at `src/cli/banner.ts`, and accepts an `Allocation + Config` plus an options bag". Do not duplicate banner formatting in `src/cli/show.ts`; reuse is the whole point.

### `src/cli/show.ts` — subcommand handler and commander registration

Two exports. The first is the commander wire-up; the second is the runnable implementation so the test file can exercise it without spawning the CLI binary.

```typescript
import type { Command } from 'commander'
import type { PortweaveError } from '../errors.ts'
import type { Result } from '../result.ts'

export interface ShowOptions {
  cwd?: string
  json?: boolean
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
}

export interface ShowOutcome {
  readonly exitCode: number
}

export async function runShow(
  options: ShowOptions,
): Promise<Result<ShowOutcome, PortweaveError>>

export function registerShowCommand(program: Command): void
```

`runShow` is the testable entry point: it accepts injectable `cwd`, `stdout`, and `stderr` streams so the test file can capture output against an in-memory `Writable` rather than asserting on real stdio. `registerShowCommand(program)` calls `program.command('show').option('--json', ...).action(async (opts) => { ... })` and forwards to `runShow`, then `process.exit(outcome.exitCode)` based on the result. The integration round in `src/cli.ts` (owned by the run-command author) calls both `registerRunCommand(program)` and `registerShowCommand(program)` against the same commander root — this spec does not touch `src/cli.ts` directly.

### Orchestration inside `runShow`

1. **Resolve cwd → AllocationKey.** Call `resolveAllocationKey(options.cwd ?? process.cwd())` from [src/worktree/key.ts:18](../../../src/worktree/key.ts). On `err`, return the error directly (commander layer translates to exit code 1 with stderr message).
2. **Load config.** Call `loadConfig(key.worktreeRoot)` from [src/config/index.ts](../../../src/config/index.ts). The banner formatter needs the `Config` to label each port with its declared `envVar`. On `err` (missing or invalid config), return the error.
3. **Look up the entry inside `withRegistry`.** Pass a callback to `withRegistry` ([src/registry/storage.ts:91](../../../src/registry/storage.ts)) that:
   - Searches `handle.entries` for an entry whose key matches the resolved `AllocationKey` (by `(gitCommonDir, worktreeRoot, namespace)` equality — same predicate `storage.ts` uses internally).
   - If found: call `handle.touch(key)` to bump `lastUsedAt`, then return the post-touch entry from `handle.entries`.
   - If not found: return `null` (the `Result` returned by `withRegistry` is still `ok`; the missing-allocation case is a successful read that produced no data).
4. **Translate to output.** If the entry is `null`, return `err(new PortweaveError(PW_ERROR_CODES.CLI_NO_ALLOCATION, ...))` — propagated below the `withRegistry` call. If found, route based on `options.json`:
   - **Human (default).** Call `formatAllocationBanner(entry, config, {})` and write to `options.stdout ?? process.stdout`. Trailing newline included by the formatter. Exit code 0.
   - **`--json`.** Build the payload (see below), `JSON.stringify(payload, null, 2)`, write to stdout with trailing newline. Exit code 0.
5. **Error → exit.** Any `err` from steps 1–4 returns `ok({ exitCode: 1 })` from `runShow` after writing the diagnostic line to `options.stderr ?? process.stderr`. The diagnostic format matches Portweave's CLI convention: `[portweave] <error.message>` for the human path, or `{"error": "<machine-readable-tag>"}` JSON for the `--json` path. The `runShow` function itself only returns `err` for the rare case where output writing fails (defensive — we cannot communicate any error in that case, so commander's catch-all surfaces it).

### Banner-line semantics for `show` vs `run`

`run` emits four `[portweave]` lines: `worktree`, `allocated`, `wrote .portweave/current.env`, `launching`. `show` emits only the first two:

```
[portweave] worktree: <basename> (namespace: <namespace>)
[portweave] allocated:
  api               → 3104     (API_PORT)
  ws                → 3105     (WS_PORT)
  ...
```

The `formatAllocationBanner` formatter handles this via the options bag — when `wroteEnvFile` and `launching` are absent, those lines are skipped. This is the explicit reuse contract; `show` does not have its own banner code path. The `<basename>` is `path.basename(allocation.key.worktreeRoot)`.

### `--json` payload shape (decided)

Single JSON document, pretty-printed with 2-space indent:

```jsonc
{
  "env": {
    "API_PORT": "3104",
    "VITE_API_URL": "http://localhost:3104",
    "WS_PORT": "3105",
  },
  "namespace": "feature-x-7a2b91",
  "ports": {
    "api": 3104,
    "ws": 3105,
  },
  "worktreeRoot": "/Users/x/repos/foo-feature-x",
}
```

Construct the `env` map by calling `buildEnvMap(allocation, config)` from [src/env/build.ts](../env-resolution/env-resolution.md) — the pure, no-I/O helper from the env-resolution spec. **`show` does not call `resolveEnv`** because that helper writes `.portweave/current.env` as a side effect; this spec is explicitly read-only. If `buildEnvMap` ends up internal to `src/env/`, the env-resolution spec should re-export it from `src/env/index.ts`; flag this in [Open questions](#open-questions). On `buildEnvMap` throwing `ENV_BUILD_INVALID` (the allocation/config-drift invariant — should be unreachable in practice), `show` catches and converts the throw to `err(PortweaveError)` rather than crashing.

The four keys (`env`, `namespace`, `ports`, `worktreeRoot`) are sorted alphabetically because the rest of Portweave's deterministic JSON output (registry file, dotenv) already commits to sorted keys via perfectionist. Consumers that rely on key order get the same answer across runs.

### Missing-allocation behaviour (decided)

The two output modes diverge on the missing-allocation case but share the exit code:

- **Human (default).** Exit code 1. Stderr line: `[portweave] no allocation for this worktree — run "portweave run" first`. Stdout is empty.
- **`--json`.** Exit code 1. Stdout: `{"error":"no-allocation"}` followed by newline. Stderr is empty.

The matching PW code is `CLI_NO_ALLOCATION = 'PW0603'`. The number is proposed in addition to the codes the run-command spec will introduce in the same `PW06xx` block (per [decision-log row #17](../../decision-log.md), addition-order within a block, gaps fine). If the run-command spec ends up using `PW0601`/`PW0602` for its own conditions, `PW0603` is the next slot. If it uses different numbers (e.g. takes `PW0601`–`PW0604` for spawn/signal/exit-code conditions), the integration round renumbers `CLI_NO_ALLOCATION` to the next free slot and updates `src/errors.ts` accordingly. No `PW06xx` slot is contractual yet; the spec only commits to "the show-command-specific code lives in `PW06xx` and is added on `Status: in-progress`".

### Why `show` calls `handle.touch` instead of leaving the entry alone

The feature doc is explicit: "the `lastUsedAt` bump that the storage layer applies on every lookup is acceptable observable behavior (it's a recency signal, not a logical mutation of the allocation)" — and the storage layer's `touch` method exists precisely for this case ([src/registry/storage.ts:49](../../../src/registry/storage.ts) and [registry-storage spec AC line](../registry-storage/registry-storage.md), "`handle.touch(key)` updates the entry's `lastUsedAt` to the current time without changing its `ports`"). Without the touch, a user who introspects an active worktree daily but never re-runs `portweave run` would see their entry pruned out from under them (the storage layer's stale-pruning policy uses `lastUsedAt` as the recency signal). Touching is the correct semantics for "lookup keeps the entry alive". The `ports` map is unchanged, so the on-disk allocation is preserved — only the recency timestamp moves.

The touch causes `withRegistry` to flag `state.mutated = true` and rewrite the registry file (see [src/registry/storage.ts:67](../../../src/registry/storage.ts)). This is a single small atomic write per `show` invocation. Acceptable.

### Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), tests live in `src/cli/__tests__/`. Real I/O against `os.tmpdir()` is preferred over mocks; the registry round-trip and config-load behaviors only have meaning against a real filesystem.

`src/cli/__tests__/show.test.ts` — integration tests against `runShow` (the testable entry point), not the spawned CLI binary. Each test sets up:

- A tempdir worktree (`os.tmpdir()` + a unique subdir, `fs.mkdir`).
- A `portweave.config.json` with at least two services so column-rendering correctness is testable.
- An `XDG_CONFIG_HOME` override pointing at a per-test registry directory (mirrors the registry-storage tests' isolation pattern).
- Captured `Writable` streams for stdout and stderr.

Test cases:

1. **Happy path, human banner.** Seed the registry with an entry for the tempdir worktree, call `runShow({ cwd, stdout, stderr })`, assert `exitCode === 0`, assert stdout contains `[portweave] worktree:`, `[portweave] allocated:`, and one row per service with the right port and envVar. Assert that the banner does _not_ contain `wrote .portweave/current.env` or `launching:` lines (proves the `options.wroteEnvFile`/`launching` defaults are respected).
2. **Happy path, JSON.** Same seed; call with `{ json: true }`. Assert stdout parses cleanly via `JSON.parse`, contains exactly the keys `env`, `namespace`, `ports`, `worktreeRoot`, that `ports` matches the seeded entry, and that `env` contains every service's `envVar` plus every discoveryEnv key.
3. **Read-only contract: no `.portweave/current.env` written.** Same seed; assert that after `runShow` returns, `fs.existsSync(<cwd>/.portweave/current.env) === false`. This is the load-bearing assertion for the feature doc's "show stays strictly read-only" promise.
4. **Read-only contract: registry entry shape unchanged except `lastUsedAt`.** Seed an entry with `lastUsedAt` set 1 hour ago; call `runShow`; reload the registry; assert the entry's `ports` and `namespace` are byte-identical, `lastUsedAt` is now within the last 2 seconds (touch happened), and no other entries were mutated.
5. **Missing allocation, human.** No registry entry. Assert `exitCode === 1`, stderr contains `no allocation for this worktree`, stdout is empty.
6. **Missing allocation, JSON.** Same seed; `{ json: true }`. Assert `exitCode === 1`, stdout is `{"error":"no-allocation"}\n`, stderr is empty.
7. **Stickiness: two consecutive `show` calls.** Run `show` twice in a row. Assert both exit 0, both produce the same `ports` payload in JSON mode, and the registry's `lastUsedAt` field on the entry strictly advances between the two calls.
8. **Upstream error propagation.** Set `cwd` to a path that is neither inside a git repo nor a writable directory ([NOT_A_GIT_REPO](../../../src/errors.ts) covers one shape; an unreadable cwd covers the other). Assert `exitCode === 1` and the stderr line includes the PW code (or its `Error.message`, depending on how the run-command spec formats CLI errors — the contract is "an exit-1 with a diagnostic", not a specific format).
9. **JSON output sort order.** With one service, assert `JSON.stringify(JSON.parse(stdout)) === '{"env":{...},"namespace":"...","ports":{...},"worktreeRoot":"..."}'` — top-level keys alphabetically sorted; `env` and `ports` inner keys also sorted. Determinism is part of the contract.

Coverage thresholds from `vitest.shared.ts` (80% across statements/branches/functions/lines) apply per [.claude/rules/testing.md](../../../.claude/rules/testing.md). The handler file is small; a single test file covers it.

### Decision-log impact

Two new rows to append on `Status: shipped`:

- The `--json` payload shape `{ env, namespace, ports, worktreeRoot }` with 2-space pretty-printing and alphabetically sorted keys. Future fields are additive — never rename or remove an existing one without a breaking-change note.
- The "show touches but never writes `.portweave/current.env`" rule, so a future maintainer does not "fix" the perceived inconsistency by adding the file-write side effect.

## Acceptance criteria

- [ ] `src/cli/show.ts` exports `runShow(options)` returning `Promise<Result<ShowOutcome, PortweaveError>>` with `ShowOutcome = { exitCode: number }`, callable from tests with injected `cwd`, `stdout`, and `stderr`, verified by `src/cli/__tests__/show.test.ts`.
- [ ] `src/cli/show.ts` exports `registerShowCommand(program)` that wires the `show` subcommand and its `--json` flag onto a commander root. Integration into `src/cli.ts` is owned by the run-command spec; this spec only commits to providing the registration function, verified by a type-level check in `show.test.ts` against the exported signature.
- [ ] Human banner matches the `[portweave] worktree:` + `[portweave] allocated:` shape from [DESIGN.md Appendix B](../../DESIGN.md), produced by reusing `formatAllocationBanner` from `src/cli/banner.ts`. No banner code lives in `src/cli/show.ts`. Verified by `src/cli/__tests__/show.test.ts` test case 1.
- [ ] `--json` output is a single JSON document with exactly the keys `env`, `namespace`, `ports`, `worktreeRoot`, alphabetically sorted at every level, pretty-printed with 2-space indent. `JSON.parse(stdout)` round-trips losslessly. Verified by `src/cli/__tests__/show.test.ts` test cases 2 and 9.
- [ ] `show` never writes `.portweave/current.env`. After any `runShow` call (success or failure), `fs.existsSync(<cwd>/.portweave/current.env) === false` unless the file already existed before the call. Verified by `src/cli/__tests__/show.test.ts` test case 3.
- [ ] `show` calls `handle.touch(key)` on the matched entry so `lastUsedAt` advances on every successful read, while `ports` and `namespace` remain byte-identical. Verified by `src/cli/__tests__/show.test.ts` test case 4.
- [ ] Missing-allocation, human mode: `exitCode === 1`; stderr line equals `[portweave] no allocation for this worktree — run "portweave run" first`; stdout is empty. Verified by `src/cli/__tests__/show.test.ts` test case 5.
- [ ] Missing-allocation, `--json` mode: `exitCode === 1`; stdout equals `{"error":"no-allocation"}\n`; stderr is empty. Verified by `src/cli/__tests__/show.test.ts` test case 6.
- [ ] A new PW error code `CLI_NO_ALLOCATION` is added to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts) on `Status: in-progress`. Proposed slot `PW0603`; final number reconciles with the run-command spec's `PW06xx` additions during integration. The code is never renumbered after publication.
- [ ] Two consecutive `runShow` calls return the same `ports` payload and strictly advance the registry's `lastUsedAt` on the entry, verified by `src/cli/__tests__/show.test.ts` test case 7.
- [ ] Upstream errors from `resolveAllocationKey`, `loadConfig`, or `withRegistry` propagate as exit-1 with a stderr diagnostic; no partial output is emitted to stdout. Verified by `src/cli/__tests__/show.test.ts` test case 8.
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across statements / branches / functions / lines) are met for `src/cli/show.ts`.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.
- [ ] Two decision-log rows are appended on `Status: shipped` capturing (a) the `--json` payload shape and sort/indent contract and (b) the "show touches but never writes `.portweave/current.env`" rule.

## Open questions

- **`buildEnvMap` visibility.** The `--json` payload needs the same env map `run` injects, computed by `buildEnvMap` from [src/env/build.ts](../env-resolution/env-resolution.md). The env-resolution spec describes `buildEnvMap` as an internal helper inside `src/env/`. For this spec to consume it cleanly, `src/env/index.ts` should re-export `buildEnvMap` alongside `resolveEnv`. Flagging because the env-resolution spec as written does not export the helper; the integration round either adds the re-export or this spec duplicates the (small, pure) logic. Recommend the re-export — duplicating template substitution across two CLI commands is exactly the kind of drift the constants/duplication checks exist to catch.
- **PW code slot.** `CLI_NO_ALLOCATION` is proposed at `PW0603` on the assumption the run-command spec uses `PW0601`/`PW0602` for its own conditions. If run-command's actual additions occupy a different range, the integration round renumbers. The decision-log already permits "addition-order within a block, gaps fine" ([row #17](../../decision-log.md)); no further policy decision is needed here, but the spec needs to flag that a renumber is possible before promotion to `Status: approved`.
