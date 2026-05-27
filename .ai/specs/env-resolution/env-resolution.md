# Env-var resolution and .portweave/current.env writer

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/env-resolution/env-resolution.md](../../features/env-resolution/env-resolution.md)
**Decision-log rows:** [#5](../../decision-log.md) (always-write `.portweave/current.env` side effect), [#17](../../decision-log.md) (PW error-code numbering — this feature opens the `PW05xx` env-resolution block)

## Problem

Allocating ports has no observable value until those numbers reach the user's dev process. Env resolution is the layer that turns an `Allocation` from [the allocator](../port-allocator/port-allocator.md) into:

1. An env-var map every wrapped child process inherits (`API_PORT=30100`, `WS_PORT=30101`, plus every constructed discovery URL like `VITE_API_URL=http://localhost:30100`).
2. A `.portweave/current.env` dotenv file that everything else on the machine can read — Docker Compose's `env_file:`, IDE run-configurations, Vite/Next config files that load before the wrapper child can inject anything, and `cat`-based introspection ([DESIGN.md §5.2](../../DESIGN.md)).

Two simultaneous consumers from one code path. The Gameweave parity goal ([DESIGN.md §7.2 rows 5, 6, 9](../../DESIGN.md)) requires both — Gameweave's internal env-injection helper hardcodes service names and URL shapes; Portweave lifts both into declarative config so the same machinery serves any project.

The `.env` priority contract ([§7.2 row 9](../../DESIGN.md)) means a user who pins `API_PORT=4000` in their project root's `.env` keeps that override — Portweave does not clobber explicit user intent. Portweave's computed values seed _unset_ keys only. (Process env then wins over both, applied by the [run-command](../run-command/run-command.md) when spawning the child.)

## Approach

Four source files plus a tests directory under `src/env/`. The public surface for downstream features ([run-command](../run-command/run-command.md), [library-runtime](../library-runtime/library-runtime.md)) is a single `resolveEnv(allocation, config, projectRoot)` entry point that computes the env map, applies `.env` overrides, writes `.portweave/current.env` atomically, and returns the final map.

### Public surface and types

```typescript
import type { Config } from '../config/index.ts'
import type { PortweaveError } from '../errors.ts'
import type { Result } from '../result.ts'
import type { Allocation } from '../allocator/allocate.ts'

export interface ResolvedEnv {
  /** Computed env map after layering .env over computed values. Keys are env-var names. */
  readonly env: Readonly<Record<string, string>>
  /** Absolute path to the .portweave/current.env file that was written. */
  readonly currentEnvPath: string
  /** True if .portweave/ had to be created on this call. */
  readonly createdPortweaveDir: boolean
}

export function resolveEnv(
  allocation: Allocation,
  config: Config,
  projectRoot: string,
): Promise<Result<ResolvedEnv, PortweaveError>>
```

`projectRoot` is the absolute path at which `.portweave/current.env` lives. `run-command` passes `allocation.key.worktreeRoot`; the library runtime passes the same thing it derived from `process.cwd()`. The spec deliberately requires the caller to pass `projectRoot` explicitly rather than re-deriving inside this layer — env resolution does not depend on `worktree-context`, which keeps the dependency graph minimal.

### `src/env/build.ts` — compute the env map from Allocation + Config

```typescript
export function buildEnvMap(
  allocation: Allocation,
  config: Config,
): Record<string, string>
```

Pure — no I/O. Walks `config.services`:

1. For each service `s` in `config.services`: assign `result[s.envVar] = String(allocation.ports[s.name])`. If `allocation.ports[s.name]` is undefined (config/allocation drift — should not happen, but defensive), throw `PortweaveError(PW_ERROR_CODES.ENV_BUILD_INVALID, ...)` (new code `PW0501`, see below) rather than silently emit an undefined value into the dotenv file.
2. For each `[discoveryKey, template]` pair in `s.discoveryEnv`: evaluate the template via `evaluateTemplate(template, allocation.ports)` and assign `result[discoveryKey] = resolved`.

Service-name collisions on `envVar` and `discoveryEnv` keys are already prevented by the config loader's `checkCrossFieldRules` ([src/config/schema.ts](../../../src/config/schema.ts)), so this layer can assume keys are unique.

### `src/env/templates.ts` — `${serviceName}` substitution

```typescript
export function evaluateTemplate(
  template: string,
  ports: Readonly<Record<string, number>>,
): string
```

Pure. Replaces every `${serviceName}` occurrence with the matching port from `ports`. Multiple placeholders per template are supported (e.g. `http://localhost:${api}/from/${ws}` → `http://localhost:30100/from/30101`). The config loader already validated that every placeholder references a real service ([src/config/schema.ts](../../../src/config/schema.ts) `checkDiscoveryEnv`), so an unknown-service reference is an invariant violation, not an expected error — throw `PortweaveError(PW_ERROR_CODES.ENV_BUILD_INVALID, ...)` with a message naming the offending service rather than emitting a malformed URL.

Implementation: a single `template.replaceAll(PLACEHOLDER_PATTERN, (_, name) => String(ports[name]))` against `/\$\{([^}]+)\}/g`.

### `src/env/dotenv-merge.ts` — read .env and apply override priority

```typescript
export function readDotenvFile(
  path: string,
): Promise<Result<Record<string, string>, PortweaveError>>

export function applyDotenvOverrides(
  computed: Readonly<Record<string, string>>,
  dotenv: Readonly<Record<string, string>>,
): Record<string, string>
```

- `readDotenvFile`: returns `ok({})` if the file does not exist (first-run case, not an error). Returns `err(PortweaveError)` with `code === PW_ERROR_CODES.ENV_DOTENV_PARSE_FAILED` (new `PW0502`) on malformed lines that cannot be parsed as `KEY=value` after stripping comments and blank lines.
- Parser is intentionally minimal — Gameweave and downstream tools all consume our output through `dotenv`-class libraries, so we only need to read user input here. Support: `KEY=value`, `KEY="value"`, `KEY='value'`, `#` comments at start of line, blank lines. Do not support variable interpolation (`${OTHER}`) inside the .env — that's a `dotenv-expand` feature and out of scope. Strip surrounding quotes when present; do not unescape escape sequences.
- `applyDotenvOverrides`: returns a new map where every key from `computed` is preserved unless the same key appears in `dotenv`, in which case the `dotenv` value wins. The `dotenv` map's _other_ keys (env vars unrelated to Portweave's allocation) are dropped — they're the user's existing dotenv concerns and not Portweave's to forward. Only keys Portweave knows about (because they appear in `computed`) get the override-vs-seed treatment.

This matches the feature doc's interpretation: existing `.env` entries _for keys Portweave would have set_ win over computed values; unrelated .env entries stay where the user put them and pass through whatever mechanism the user's stack normally uses.

### `src/env/writer.ts` — atomic write + `.portweave/` bootstrap

Three functions:

```typescript
export function ensurePortweaveDir(
  projectRoot: string,
): Promise<{ created: boolean }>
export function atomicWriteDotenv(
  path: string,
  env: Readonly<Record<string, string>>,
): Promise<void>
export function serializeDotenv(env: Readonly<Record<string, string>>): string
```

- `ensurePortweaveDir`: `fs.mkdir(<projectRoot>/.portweave, { mode: 0o700, recursive: true })`. If we just created the directory (caught via the recursive-mkdir return value, or by `existsSync` check before mkdir), also write `.portweave/.gitignore` with `*\n` content per the feature doc's recommended-yes open question. Idempotent — if `.gitignore` already exists, do not overwrite. Returns whether the directory had to be created this call (for the banner). Uses `recursive: true` so a missing parent doesn't error.
- `atomicWriteDotenv`: writes to `${path}.tmp.${pid}.${Date.now()}` then `fs.rename` to the final path, mirroring [src/registry/atomic-write.ts](../../../src/registry/atomic-write.ts) exactly. Stale-tempfile cleanup (the 60s sibling-prune from registry-storage) is _not_ needed here because the file is short-lived from the caller's perspective and there's no read-loop that benefits from cleanup; if a future contributor wants symmetry, that's a small additive change.
- `serializeDotenv`: deterministic — keys sorted ascending (the perfectionist ordering already in effect across the codebase), `KEY=value\n` per line, trailing newline. Quote values that contain whitespace, `#`, `$`, `"`, `'`, or backslash — wrap in double quotes and escape `"` as `\"` and `\` as `\\`. Plain URL values (`http://localhost:30100`) pass through unquoted. No header comment at v0 — the file is small enough that the line-by-line content is self-documenting; a header would just add noise on each diff.

### `src/env/index.ts` — public composition

Re-exports the public surface so consumers depend on `src/env/index.ts` rather than reaching into individual files:

```typescript
export { buildEnvMap } from './build.ts'
export { evaluateTemplate } from './templates.ts'
export { resolveEnv, type ResolvedEnv } from './resolve.ts'
```

`buildEnvMap` is part of the public surface because [`show-command`](../show-command/show-command.md) needs to compute the env map for `--json` output **without** triggering the `.portweave/current.env` side-effect write (that's `resolveEnv`'s job). The pure `buildEnvMap` keeps show-command's introspection path side-effect-free.

`resolveEnv` itself lives in `src/env/resolve.ts` (not `index.ts`) so the index stays a thin re-export surface:

```typescript
// src/env/resolve.ts
import { resolve } from 'node:path'

export async function resolveEnv(
  allocation: Allocation,
  config: Config,
  projectRoot: string,
): Promise<Result<ResolvedEnv, PortweaveError>> {
  const computed = buildEnvMap(allocation, config) // pure; throws PW0501 on drift
  const dotenvPath = resolve(projectRoot, '.env')
  const dotenvResult = await readDotenvFile(dotenvPath)
  if (!dotenvResult.ok) return dotenvResult
  const final = applyDotenvOverrides(computed, dotenvResult.value)
  const { created } = await ensurePortweaveDir(projectRoot)
  const currentEnvPath = resolve(projectRoot, '.portweave/current.env')
  await atomicWriteDotenv(currentEnvPath, final)
  return ok({ createdPortweaveDir: created, currentEnvPath, env: final })
}
```

The `buildEnvMap` throw is acceptable here because the conditions that trigger it (port map missing a service from the config) represent allocation/config drift that the caller cannot recover from — it's an invariant violation per [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md). Wrap the call in a try/catch inside `resolveEnv` and convert the thrown `PortweaveError` into the `Result` shape so the public surface stays uniformly `Result`-based:

```typescript
try {
  computed = buildEnvMap(allocation, config)
} catch (caught: unknown) {
  if (caught instanceof PortweaveError) return err(caught)
  throw caught
}
```

### New PW error codes

Two new codes seeded by this feature (per [decision-log row #17](../../decision-log.md)'s "addition order within block, gaps fine"):

- `ENV_BUILD_INVALID = 'PW0501'` — allocation/config drift; a service in the config has no port in the allocation, or a `discoveryEnv` template references a service not in the allocation. Should be unreachable in practice given the config loader's validation.
- `ENV_DOTENV_PARSE_FAILED = 'PW0502'` — user's project-root `.env` has malformed lines.

Add both to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts) on `Status: in-progress`.

### Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), tests live in `src/env/__tests__/`. Real I/O against `os.tmpdir()`.

- `src/env/__tests__/build.test.ts` — `buildEnvMap` on the DESIGN.md Appendix A config + a synthetic allocation produces every env var in DESIGN.md Appendix B; missing port for a config service throws `PW0501`.
- `src/env/__tests__/templates.test.ts` — single-placeholder substitution; multi-placeholder substitution; placeholder for unknown service throws `PW0501`; templates with no placeholders pass through unchanged.
- `src/env/__tests__/dotenv-merge.test.ts` — `readDotenvFile` against a fixture file (KEY=value, quoted, comments, blanks); missing file returns `ok({})`; malformed line returns `PW0502`; `applyDotenvOverrides` drops keys not in `computed`, keeps `computed` keys absent from `dotenv`, lets `dotenv` win for shared keys.
- `src/env/__tests__/writer.test.ts` — `ensurePortweaveDir` creates the directory and a `.gitignore` containing `*` on first call; the second call is a no-op (does not overwrite `.gitignore`); `atomicWriteDotenv` writes to a tempfile and renames; `serializeDotenv` produces sorted output with quoting for special chars.
- `src/env/__tests__/resolve.test.ts` — integration: a fixture project root with an existing `.env` containing `API_PORT=4000` and `OTHER_THING=foo`, plus a config that allocates 30100 for `api` and includes `VITE_API_URL` discovery URL. `resolveEnv` produces an env map where `API_PORT=4000` (override), `VITE_API_URL=http://localhost:30100` (computed using the allocated port — not 4000, because Portweave is uninterested in trying to back-derive overridden values into discovery URLs), and the written `.portweave/current.env` contains the same values.

Coverage thresholds from `vitest.shared.ts` (80% across all four metrics) apply per [.claude/rules/testing.md](../../../.claude/rules/testing.md).

### Decision-log impact

Three new rows to append on `Status: shipped`:

- `.portweave/.gitignore` is auto-created with `*` content on first directory creation; existing `.gitignore` is never overwritten.
- `.env` override semantics: only keys Portweave would have set are subject to override; unrelated `.env` keys are not forwarded by `resolveEnv` and pass through whatever consumer the user's stack already uses.
- Discovery URL templates always use the _allocated_ port, even when the user has overridden the corresponding service's envVar in `.env`. This is a deliberate "Portweave is uninterested in back-deriving overridden values" choice — overrides should be explicit per-key, not transitive through templates.

## Acceptance criteria

- [ ] `src/env/index.ts` exports `resolveEnv(allocation, config, projectRoot) -> Promise<Result<ResolvedEnv, PortweaveError>>` and the pure `buildEnvMap(allocation, config) -> Record<string, string>`, both consumable from `run-command`, `show-command`, and `library-runtime` without reaching into individual `src/env/*.ts` files.
- [ ] `src/env/build.ts#buildEnvMap` is pure and produces one entry per service `envVar` plus every resolved `discoveryEnv` entry. The DESIGN.md Appendix A sample config paired with a realistic allocation produces exactly the env-var keys shown in DESIGN.md Appendix B, verified by `src/env/__tests__/build.test.ts`.
- [ ] `src/env/templates.ts#evaluateTemplate` substitutes every `${serviceName}` occurrence with the matching port. Multi-placeholder templates (e.g. `http://localhost:${api}/from/${ws}`) resolve correctly, verified by `src/env/__tests__/templates.test.ts`.
- [ ] `src/env/dotenv-merge.ts#readDotenvFile` parses `KEY=value`, quoted variants, and comments; returns `ok({})` for a missing file; returns `err(PortweaveError)` with `code === PW_ERROR_CODES.ENV_DOTENV_PARSE_FAILED` (`PW0502`) on a malformed line, verified by `src/env/__tests__/dotenv-merge.test.ts`.
- [ ] `applyDotenvOverrides(computed, dotenv)` returns a map where every key in `computed` is preserved except those also present in `dotenv` (which win), and `dotenv`-only keys are dropped, verified by `src/env/__tests__/dotenv-merge.test.ts`.
- [ ] `src/env/writer.ts#ensurePortweaveDir` creates `<projectRoot>/.portweave/` if missing and writes `.portweave/.gitignore` with `*\n` content on first creation. A second call does not overwrite an existing `.gitignore`, verified by `src/env/__tests__/writer.test.ts`.
- [ ] `src/env/writer.ts#atomicWriteDotenv` writes via tempfile + rename (mirroring [src/registry/atomic-write.ts](../../../src/registry/atomic-write.ts)). A crash mid-write leaves the prior file (if any) intact, verified by `src/env/__tests__/writer.test.ts`.
- [ ] `serializeDotenv` produces deterministic, sorted dotenv output. Values containing whitespace, `#`, `$`, `"`, `'`, or backslash are quoted with double quotes; plain URL values (`http://localhost:30100`) pass through unquoted, verified by `src/env/__tests__/writer.test.ts`.
- [ ] **End-to-end integration**: a fixture project root with `.env` containing `API_PORT=4000`, paired with an allocation `{api: 30100}` and a config with `api.envVar=API_PORT` plus `api.discoveryEnv.VITE_API_URL='http://localhost:${api}'`, produces a `ResolvedEnv` where `env.API_PORT === '4000'` (override) and `env.VITE_API_URL === 'http://localhost:30100'` (template always uses allocated port). The written `.portweave/current.env` contains the same values, verified by `src/env/__tests__/resolve.test.ts`.
- [ ] Two new PW error codes (`ENV_BUILD_INVALID=PW0501`, `ENV_DOTENV_PARSE_FAILED=PW0502`) are added to `PW_ERROR_CODES` in [src/errors.ts](../../../src/errors.ts).
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across statements / branches / functions / lines) are met for every new source file under `src/env/`.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.
- [ ] Three decision-log rows are appended on `Status: shipped` capturing (a) the `.portweave/.gitignore` auto-creation rule, (b) the `.env`-only-overrides-known-keys semantics, and (c) the "templates always use allocated port" rule.

## Open questions

- **Dotenv parser scope.** The minimal parser supports `KEY=value`, quotes, and comments but not interpolation (`${OTHER}`), heredocs, or escape-sequence unescaping. This matches what's necessary for the override semantics (we only read the user's keys' values, we never re-emit them). If a real-world `.env` file has interpolation Portweave will treat the literal `${OTHER}` string as the override value, which is wrong from the user's POV but at least surfaces visibly in `.portweave/current.env`. Flagging because a future "use `dotenv` package directly" PR is non-controversial; recommend keeping the parser minimal at v0 to avoid pulling a runtime dep for this slim use case.
- **Empty allocation.** If a config declares zero services (impossible per the config loader's `min(1)` refine, but defense-in-depth), `resolveEnv` produces an empty env map and still writes an empty `.portweave/current.env`. The current spec writes an empty file in this case; an alternative is to skip the write entirely. Recommend writing the empty file — predictability for the IDE/Compose consumers that expect the file to exist after every `portweave run`. Flagging in case approval prefers the skip-write variant.
