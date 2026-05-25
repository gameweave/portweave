# portweave run CLI wrapper

**Status:** approved
**Owner:** TBD
**Feature doc:** [.ai/features/run-command/run-command.md](../../features/run-command/run-command.md)
**Decision-log rows:** [#5](../../decision-log.md) (wrapper CLI primary; always-write `.portweave/current.env` side effect), [#17](../../decision-log.md) (PW error-code numbering — this feature opens the `PW06xx` CLI block)

## Problem

Allocating ports and computing env vars has no observable value until those numbers reach the user's dev process. `portweave run -- <cmd>` is where every upstream feature ([config-loader](../config-loader/config-loader.md), [worktree-context](../worktree-context/worktree-context.md), [registry-storage](../registry-storage/registry-storage.md), [port-allocator](../port-allocator/port-allocator.md), [env-resolution](../env-resolution/env-resolution.md)) becomes a single user-facing affordance: substitute `portweave run -- npm start` for `npm start` and get allocated ports plus env vars wired into an existing dev workflow without further configuration ([feature doc](../../features/run-command/run-command.md), [DESIGN.md §5.2](../../DESIGN.md)).

This feature also makes the "two consumption modes from one code path" contract from [DESIGN.md §5.2](../../DESIGN.md) visible: the wrapper injects the computed env into the spawned child **and** the same run writes `.portweave/current.env` as a side effect (env-resolution does the write; this feature is the always-on caller that triggers it on every invocation per [decision-log row #5](../../decision-log.md)). Docker Compose, IDE run configs, Vite/Next config files that read env at module-load time, and a quick `cat .portweave/current.env` all see the same allocation without further wiring.

The allocation summary banner from [DESIGN.md Appendix B](../../DESIGN.md) also lands here. The banner is how a developer confirms at a glance which ports the run picked up, which worktree namespace it resolved to, and that the side-effect env file was written — turning what would otherwise be an opaque env-injection layer into something inspectable in the same terminal the developer was already watching. The banner is also the first observable "did Portweave do something?" output and so it must go to **stderr**, not stdout, so child stdout pipelines (`portweave run -- generate-data | jq`) are not polluted.

The wrapper sits at the top of the v0 dependency graph. Everything else is plumbing; this is the spine.

## Approach

Four source files plus a tests directory under `src/cli/`, plus a rewrite of [src/cli.ts](../../../src/cli.ts) (currently a 4-line stub) into the commander root. The public surface is one binary — `portweave run -- <cmd> [args...]` — driven through three composable internals: `run.ts` (orchestrator), `spawn.ts` (child-process wrapper), and `banner.ts` (output formatter consumed by both this feature and the parallel-drafted [show-command](../show-command/) spec).

### `src/cli.ts` — commander root

Rewrites the current 4-line stub. Responsibilities:

1. Construct the commander root (`new Command('portweave')`), set version from `package.json`, configure `enablePositionalOptions()` so the `-- <cmd> [args...]` passthrough works without commander trying to parse the child's flags.
2. Define three global flags on the root via `.option()`: `--config <path>`, `--count <n>`, `--verbose`. These are read in the subcommand action via `program.opts()` so global flags work whether placed before or after the subcommand name.
3. Register subcommands: `run` (this spec) plus a stub for `show` (parallel-drafted, lands in [show-command](../show-command/)). Subcommand registration is a function call (`registerRunCommand(program)`, `registerShowCommand(program)`) so each subcommand owns its own `Command` construction and stays in its own file.
4. `program.parseAsync(process.argv)` at the bottom. Top-level errors thrown out of an action handler are caught here and converted into a non-zero exit + a `[portweave]` error line on stderr. `PortweaveError` instances format as `[portweave] error: <message> (<code>)`; everything else gets `[portweave] error: <message>` and (only with `--verbose`) the stack trace.

Public shape:

```typescript
export function buildCli(): Command
export async function main(
  argv: readonly string[] = process.argv,
): Promise<number>
```

`buildCli` returns the constructed `Command` so the integration test can exercise commander wiring without booting a real subprocess (`buildCli().parseAsync([...])`). `main` is what `dist/cli.js`'s shebang invokes; it returns the process exit code. The shebang line at the top of the source file (`#!/usr/bin/env node`) stays.

### `src/cli/run.ts` — `run` subcommand handler

```typescript
import type { Command } from 'commander'

export function registerRunCommand(program: Command): void

export interface RunOptions {
  configPath?: string
  count?: number
  verbose: boolean
}

export async function runCommand(
  childArgs: readonly string[],
  options: RunOptions,
  io: RunIo = defaultRunIo,
): Promise<number>

export interface RunIo {
  cwd: () => string
  stderr: NodeJS.WritableStream
  stdout: NodeJS.WritableStream
  env: NodeJS.ProcessEnv
}
```

`registerRunCommand` attaches the subcommand to the root and wires its action into `runCommand`. `runCommand` is the testable entry point — the integration tests invoke it directly with a synthetic `RunIo` so we can assert exact banner output without parsing real stderr. The default `RunIo` is `{ cwd: process.cwd, stderr: process.stderr, stdout: process.stdout, env: process.env }`.

Orchestration steps inside `runCommand`:

1. **Validate flag combinations.** If both `options.configPath` and `options.count !== undefined` are set, return `err(PortweaveError(CLI_INVALID_FLAGS, '--config and --count are mutually exclusive'))` → log it and return exit `1`. Same for `--count` with a non-positive or non-integer value (commander will pass strings through; we coerce + validate ourselves). Same for an empty `childArgs` array — `portweave run --` with nothing after is `CLI_INVALID_FLAGS`. Both error paths use the new code `PW0601` (see "PW error codes" below).
2. **Resolve worktree context.** Call `resolveAllocationKey(io.cwd())` from [src/worktree/key.ts](../../../src/worktree/key.ts). Propagate errors as exit `1` with the banner formatter's error variant.
3. **Load config or synthesize anonymous.** If `options.count` is set, call `synthesizeAnonymousConfig(options.count)` from [src/config/anonymous.ts](../../../src/config/anonymous.ts). Otherwise call `loadConfig(io.cwd(), { configPath: options.configPath })` from [src/config/loader.ts](../../../src/config/loader.ts). Propagate errors.
4. **Allocate.** Call `allocate(key, config, io.env)` from [src/allocator/allocate.ts](../allocator/) (drafted in the [port-allocator spec](../port-allocator/port-allocator.md)). Receive `{ allocation, reused }`. Propagate errors.
5. **Resolve env.** Call `resolveEnv(allocation, config, allocation.key.worktreeRoot)` from [src/env/index.ts](../env-resolution/) (drafted in the [env-resolution spec](../env-resolution/env-resolution.md)). Propagate errors. The returned `ResolvedEnv` has `env`, `currentEnvPath`, and `createdPortweaveDir`.
6. **Print the banner** to `io.stderr` via `banner.ts`'s `formatAllocationBanner(...)`. See banner shape below.
7. **Spawn the child.** Call `spawnChild(childArgs, { env: mergedEnv, io })` from `spawn.ts`. The merged env is `{ ...io.env, ...resolvedEnv.env }` — Portweave's allocation seeds keys, the parent process env wins on conflict ([env-resolution feature doc](../../features/env-resolution/env-resolution.md), [DESIGN.md §7.2 row 9](../../DESIGN.md): `.env` overrides ⊂ resolveEnv; process env overrides ⊂ runCommand).
8. **Return the child's exit code.** `spawnChild` resolves with `{ exitCode, signal }`; `runCommand` returns the integer exit code (or `128 + signal-number` for signal-terminated children, matching POSIX shell convention).

`--verbose` adds three diagnostic lines to the banner: the absolute config path that was resolved (or `<anonymous-mode>`), the absolute registry path, and the resolved `AllocationKey` (json-stringified single line). Failure paths print the underlying error stack trace to stderr in verbose mode.

### `src/cli/banner.ts` — `[portweave]` allocation banner formatter

**Coordination call-out:** This file is consumed by both `run-command` (this spec) **and** [`show-command`](../show-command/) (the parallel-drafted sibling spec). `show-command` will import `formatAllocationBanner` and reuse the per-service rendering with `reused: true` (so its banner reads "reusing existing allocation" instead of "allocated"). Define the public function signature here; show-command must consume it without re-implementing the formatting logic to keep the two commands' visual output identical.

```typescript
import type { Allocation } from '../allocator/allocate.ts'
import type { Config } from '../config/index.ts'
import type { ResolvedEnv } from '../env/index.ts'

export interface BannerInput {
  allocation: Allocation
  config: Config
  resolvedEnv: ResolvedEnv
  reused: boolean
  verboseLines?: readonly string[]
  launchingCommand?: string // e.g. "pnpm dev" — omitted by show-command
}

export function formatAllocationBanner(input: BannerInput): string

export function formatErrorLine(message: string, code?: string): string
```

`formatAllocationBanner` returns a multi-line string (caller appends one trailing newline and writes once) matching [DESIGN.md Appendix B](../../DESIGN.md):

```
[portweave] worktree: <worktreeRoot-basename> (namespace: <namespace>)
[portweave] <action>:
  <service-name padded>  → <port>     (<env-var>)
  ...
[portweave] wrote .portweave/current.env
[portweave] launching: <cmd>
```

Where `<action>` is `allocated` when `reused === false` and `reusing existing allocation` when `reused === true`. The "launching" line is emitted only when `launchingCommand` is provided (run-command sets it; show-command omits it). Service rows are left-padded to the longest service name + 2 spaces of breathing room; ports are not padded (they're 4-5 digits and visual alignment is not load-bearing). Service order in the banner matches `config.services` ordering as returned by the allocator's `orderServicesForAllocation` ([port-allocator spec](../port-allocator/port-allocator.md)) — the allocator is the single source of truth on service ordering, so the banner mirrors what's on disk in the registry record.

`verboseLines` is an array of pre-formatted strings to append after the `wrote .portweave/current.env` line and before the `launching:` line, each already prefixed with `[portweave] `.

`formatErrorLine(message, code?)` returns either `[portweave] error: <message> (<code>)` or `[portweave] error: <message>` — the common shape every error path uses.

The formatter is pure (no I/O, no global state). All tests are snapshot-friendly fixtures.

### `src/cli/spawn.ts` — child-process wrapper with signal forwarding

```typescript
export interface SpawnChildOptions {
  env: NodeJS.ProcessEnv
  io: Pick<RunIo, 'stderr' | 'stdout'>
  signal?: AbortSignal // optional, for test cancellation
}

export interface SpawnChildResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export function spawnChild(
  argv: readonly string[],
  options: SpawnChildOptions,
): Promise<Result<SpawnChildResult, PortweaveError>>
```

Implementation:

- Uses `child_process.spawn(argv[0], argv.slice(1), { env: options.env, stdio: 'inherit' })`. `stdio: 'inherit'` lets the child share the parent's TTY directly — no piping, no buffering. This is the same shape as boardflip's [scripts/bin/dev.ts](../../../reference/boardflip/scripts/bin/dev.ts).
- **Signal forwarding.** Install handlers on the parent for `SIGINT` and `SIGTERM` that forward the same signal to the child (`child.kill(signal)`). Handlers are torn down in a `finally` after the child exits so a second SIGINT (the "really stop now" pattern) hits the parent normally. The child gets one handler per signal; multiple sends produce multiple forwards.
- **Exit-code propagation.** Resolve when the child emits `'exit'` with `{ exitCode: code, signal }`. The caller (`runCommand`) translates `{ exitCode: null, signal: 'SIGINT' }` into shell-convention `128 + 2 = 130` etc. Resolving the promise (rather than rejecting) for any child exit — even non-zero — is intentional: the wrapper's job is to _propagate_ the child's status, not to interpret it as an error.
- **Spawn errors.** A failure before the child starts (e.g. `ENOENT` on a bogus command) emits `child.on('error', ...)`. Convert to `err(PortweaveError(CLI_CHILD_SPAWN_FAILED, ...))` — code `PW0602`. The caller logs via `formatErrorLine` and returns exit code `127` (POSIX command-not-found convention).
- No PATH resolution shenanigans: `spawn` uses the system's PATH by default. The first arg in `childArgs` is whatever the user typed after `--` — we do not prepend `sh -c` or any shell. This keeps the command transparent and matches boardflip's behavior.

### `src/cli/__tests__/` — test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), tests live in `src/cli/__tests__/` and prefer real I/O against `os.tmpdir()`.

- `src/cli/__tests__/banner.test.ts` — pure-function tests of `formatAllocationBanner`: fresh allocation (`reused: false`) produces the "allocated:" verb; sticky (`reused: true`) produces "reusing existing allocation:"; service-name padding handles unequal lengths; multi-service config (DESIGN.md Appendix A) snapshot-matches Appendix B's layout (modulo specific port numbers); `verboseLines` inserts after `wrote` and before `launching`; `launchingCommand: undefined` omits the launching line (the show-command path).
- `src/cli/__tests__/spawn.test.ts` — spawns a real `node -e` child returning a known exit code, asserts the promise resolves with the matching `exitCode`; spawns a bogus command (`nonexistent-xyz-9999`) and asserts `err(PortweaveError)` with `code === PW_ERROR_CODES.CLI_CHILD_SPAWN_FAILED`; spawns a real `node -e 'setTimeout(() => process.exit(0), 5000)'` child and sends `SIGTERM` to the parent's spawn helper via an `AbortSignal`-controlled path, asserts the child receives `SIGTERM` and the result reports the signal. The signal-forwarding test is the load-bearing one — it must run as a real subprocess with real signals to be meaningful.
- `src/cli/__tests__/run.test.ts` — integration: a fixture directory under `os.tmpdir()` initialized as a git repo with a minimal `portweave.config.json` declaring one service `api` with `envVar: API_PORT`. Calls `runCommand(['node', '-e', 'console.log(process.env.API_PORT); process.exit(0)'], { verbose: false })` with a `RunIo` whose `cwd()` returns the fixture path. Asserts: exit code `0`; `.portweave/current.env` exists at the fixture path and contains an `API_PORT=` line; banner lines were written to `io.stderr` matching the Appendix B shape; child stdout (captured via `stdio: 'inherit'` redirection in the test harness — see below) prints the same port that appears in `.portweave/current.env`.
  - Because `stdio: 'inherit'` makes capturing child stdout awkward inside Vitest, the test harness uses a sub-fixture command that writes `process.env.API_PORT` to a known file under the fixture dir and asserts on file contents, not on captured stdout. This is the same pattern the registry-storage concurrent test uses.
- `src/cli/__tests__/run-anonymous.test.ts` — fixture dir with no `portweave.config.json`. Calls `runCommand(['node', '-e', 'console.log(process.env.PORT_1)'], { count: 3, verbose: false })`. Asserts the child sees `PORT_1`, `PORT_2`, `PORT_3` (write all three to a fixture file and assert all three are present and distinct).
- `src/cli/__tests__/run-flags.test.ts` — pure-CLI flag validation: `--config` + `--count` together returns exit `1` with `CLI_INVALID_FLAGS`; empty child args returns exit `1` with `CLI_INVALID_FLAGS`; `--count` with a non-integer (`--count abc`) returns exit `1` with `CLI_INVALID_FLAGS`; `--config ./alt.config.json` loads the named file rather than the default.
- `src/cli/__tests__/run-signals.test.ts` — only runs on non-Windows. Spawns a fixture child that traps `SIGINT` and writes "got SIGINT" to a fixture file before exiting `130`. Sends `SIGINT` to the parent's `runCommand` invocation via process injection (set up via the child-fork pattern in [src/registry/**tests**/storage.concurrent.test.ts](../../../src/registry/__tests__/)). Asserts the child's marker file is present and `runCommand` resolved with exit code `130`.

Coverage thresholds in `vitest.shared.ts` (80% across statements / branches / functions / lines) apply per [.claude/rules/testing.md](../../../.claude/rules/testing.md).

### New PW error codes

Two new codes seeded by this feature (per [decision-log row #17](../../decision-log.md)'s "addition order within block, gaps fine"):

- `CLI_INVALID_FLAGS = 'PW0601'` — conflicting or malformed CLI flags (`--config` + `--count`, empty child argv, non-integer `--count`).
- `CLI_CHILD_SPAWN_FAILED = 'PW0602'` — child process failed to spawn (typically `ENOENT`). Distinct from "child ran and exited non-zero" — that's not an error from the wrapper's perspective, it's the contract.

Add both to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts) on `Status: in-progress`.

### Coordination call-outs

Three cross-feature coordination points the implementation merge must respect:

1. **`src/cli/banner.ts` is shared with [show-command](../show-command/).** The `formatAllocationBanner` signature defined above is the contract — show-command imports it and passes `launchingCommand: undefined` to omit the bottom line. If show-command needs additional shapes (e.g. printing a `not allocated yet` state), it adds them via a _separate_ exported function in `banner.ts` rather than mutating `formatAllocationBanner`'s signature.
2. **`package.json#bin` already points at `./dist/cli.js`** (see line 8 of [package.json](../../../package.json)). The current `tsconfig.json` has `noEmit: true`, so `npm run build` (`tsc --build`) does not currently produce `dist/`. This spec's implementation must either: (a) flip `noEmit: false` and verify the emitted `dist/cli.js` has the shebang line preserved + executable bit set; or (b) document why `dist/cli.js` doesn't ship at v0 (e.g. `tsx`-driven dev-only usage). Recommend (a) — published-on-npm is the explicit form-factor goal ([DESIGN.md §5.5](../../DESIGN.md)). Note the build-output requirement in the implementation PR but do not alter `package.json#bin` (the path is already correct).
3. **The parallel-drafted [`library-runtime`](../library-runtime/) spec modifies `package.json#exports`.** This spec only touches `package.json#bin` (already present, may need `chmod +x` plumbing in the build) and adds `commander` to `dependencies`. The two spec's package.json edits are non-overlapping; the integration merge of both worktrees should be conflict-free as long as both PRs preserve the existing key order.

A fourth implementation note: `commander` is currently in `package-lock.json` only as a _transitive_ dependency (pulled in by `constants-check`). The roadmap claims it's in `dependencies` already; verify and add `"commander": "^12.1.0"` to `dependencies` in the implementation PR.

### Decision-log impact

Three new rows to append on `Status: shipped` (not on `draft` — only when implementation ratifies the choices):

- Banner output stream = stderr (open question in the feature doc, recommendation per orchestration plan).
- `--config` + `--count` are mutually exclusive; passing both is `CLI_INVALID_FLAGS`.
- Exit-code translation: `null exitCode + signal` becomes `128 + signal-number` per POSIX shell convention; spawn-failure becomes `127`.

## Acceptance criteria

- [ ] `src/cli.ts` exports `buildCli()` and `main(argv)`; the commander root has `--config <path>`, `--count <n>`, and `--verbose` global flags wired via `program.opts()`, and registers a `run` subcommand, verified by `src/cli/__tests__/run-flags.test.ts`.
- [ ] `src/cli/run.ts` exports `runCommand(childArgs, options, io?)` returning `Promise<number>` (exit code). The function orchestrates worktree-context → config (file or anonymous) → allocator → env-resolution → banner → spawn in that order, verified by `src/cli/__tests__/run.test.ts`.
- [ ] Running `portweave run -- node -e 'fs.writeFileSync(out, String(process.env.API_PORT))'` in a fixture directory with a config declaring an `api` service writes the allocated port into the fixture output file (proves env injection reached the child), verified by `src/cli/__tests__/run.test.ts`.
- [ ] The child process receives every env var produced by `resolveEnv`, merged with the parent's env (parent wins on key conflict per [env-resolution spec](../env-resolution/env-resolution.md) chain — `.env` overrides resolved env, parent process env overrides everything), verified by `src/cli/__tests__/run.test.ts`.
- [ ] `src/cli/spawn.ts#spawnChild` uses `stdio: 'inherit'` and resolves with `{ exitCode, signal }`; a child exit code of `0` produces `runCommand` returning `0`; a non-zero child exit produces the same non-zero return from `runCommand`, verified by `src/cli/__tests__/spawn.test.ts` and `run.test.ts`.
- [ ] SIGINT and SIGTERM received by the parent process are forwarded to the child; a child that traps SIGINT and exits `130` produces `runCommand` returning `130`. Signal handlers are torn down after the child exits, verified by `src/cli/__tests__/run-signals.test.ts` (test skipped on Windows).
- [ ] Spawn failure (e.g. `ENOENT` on a bogus command) returns `err(PortweaveError)` with `code === PW_ERROR_CODES.CLI_CHILD_SPAWN_FAILED` (`PW0602`); `runCommand` returns exit code `127` and writes a `[portweave] error: ...` line to stderr, verified by `src/cli/__tests__/spawn.test.ts`.
- [ ] `--config <path>` + `--count <n>` together returns exit code `1` with `CLI_INVALID_FLAGS` (`PW0601`); empty child argv (`portweave run --`) returns exit `1` with the same code; `--count abc` (non-integer) returns exit `1` with the same code, verified by `src/cli/__tests__/run-flags.test.ts`.
- [ ] `--count 3` in a directory with no `portweave.config.json` succeeds: the child sees `PORT_1`, `PORT_2`, `PORT_3` as distinct integer env values, verified by `src/cli/__tests__/run-anonymous.test.ts`.
- [ ] `--config ./alt.config.json` loads the named file instead of the default discovery path, verified by `src/cli/__tests__/run-flags.test.ts`.
- [ ] `src/cli/banner.ts#formatAllocationBanner` produces output matching [DESIGN.md Appendix B](../../DESIGN.md): a `[portweave] worktree: <name> (namespace: <ns>)` header, an `[portweave] allocated:` (or `reusing existing allocation:`) verb line, one `  <name>  → <port>     (<envVar>)` row per service, a `[portweave] wrote .portweave/current.env` line, and a `[portweave] launching: <cmd>` line. The "launching" line is omitted when `launchingCommand` is undefined (the show-command code path), verified by `src/cli/__tests__/banner.test.ts`.
- [ ] All banner output is written to `io.stderr`, not stdout. A child whose stdout is piped (`portweave run -- echo hello | grep h`) sees no `[portweave]` lines on its stdout side, verified by `src/cli/__tests__/run.test.ts`.
- [ ] `--verbose` adds the resolved config path, registry path, and allocation key (JSON-stringified single line) to the banner via `verboseLines`, verified by `src/cli/__tests__/banner.test.ts` and `run-flags.test.ts`.
- [ ] `formatAllocationBanner` is importable from `src/cli/banner.ts` by [show-command](../show-command/) without modification; its signature accepts `launchingCommand?: string` and `reused: boolean` so show-command can opt into the "reusing existing allocation" verb and omit the launching line, verified by an exported-symbols assertion in `src/cli/__tests__/banner.test.ts`.
- [ ] Two new PW error codes (`CLI_INVALID_FLAGS=PW0601`, `CLI_CHILD_SPAWN_FAILED=PW0602`) are added to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts).
- [ ] `commander` is added to `dependencies` in [package.json](../../../package.json) (currently transitive-only via `constants-check`). The existing `bin: { "portweave": "./dist/cli.js" }` entry is preserved unchanged.
- [ ] The build produces an executable `dist/cli.js` with a `#!/usr/bin/env node` shebang preserved from source; running `node ./dist/cli.js --help` prints the commander-generated help text. (Implementation note: `tsconfig.json#noEmit` must be reconciled — either flipped to `false` or replaced with a build-time tsconfig override that emits.)
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across statements / branches / functions / lines) are met for every new source file under `src/cli/`.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.
- [ ] Three decision-log rows are appended on `Status: shipped` capturing (a) banner-to-stderr, (b) `--config` + `--count` mutual exclusion, and (c) exit-code translation rules (signal → 128+n, spawn failure → 127).

## Open questions

- **Banner-row alignment width.** The current spec left-pads service names to the longest-name length + 2 spaces and does not pad ports. DESIGN.md Appendix B shows visually aligned ports across rows (each port is followed by spaces to align the `(<env-var>)` column). Going with name-only padding is simpler and survives long URL-style env var names; full-column alignment matches the sample exactly. Recommend keeping name-only padding for v0; flagging in case approval prefers Appendix B's exact column alignment.
- **`--verbose` redaction.** The verbose block prints the resolved `AllocationKey` JSON-stringified. That includes the absolute `worktreeRoot` and `gitCommonDir` — useful for debugging, but those paths can be sensitive in some setups (e.g. CI runners that don't want filesystem layout in logs). Recommend keeping verbose unredacted at v0 (the user opted into it) and adding a `--verbose=safe` mode later if real usage surfaces the need.
- **Empty config services.** If `loadConfig` returns a config with zero services (impossible per the loader's `min(1)` refine but defense-in-depth), the banner would print no service rows and the allocator would no-op. The spec currently lets that flow happen — the resulting empty `.portweave/current.env` is still written. Flagging in case approval prefers an explicit early-exit with a "config declares no services" error; recommend the silent-pass behavior since the upstream loader is the right place to enforce non-emptiness.
