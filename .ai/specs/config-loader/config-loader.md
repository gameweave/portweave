# Config loader and anonymous mode

**Status:** approved
**Owner:** TBD
**Feature doc:** [.ai/features/config-loader/config-loader.md](../../features/config-loader/config-loader.md)
**Decision-log rows:** Implements DESIGN.md row #10 (config style — named-services floor) and row #5 (consumption — `portweave run` reads config). Resolves DESIGN.md §6.1 by adopting option (d) named-services plus option (a) zero-config anonymous (per v0 roadmap §2). No new decision-log row required.

## Problem

Every downstream v0 feature past `result-types` needs to know one thing first: _which services does this project have, what are they called, and how should their ports surface to user code?_ Without a normalized, validated service inventory, the allocator can't decide how many ports to claim, the env-resolver can't compute env-var assignments or expand discovery URLs, and the CLI has nothing to spawn against.

Equally important is the zero-friction onboarding path. A developer who just wants "three free ports for a one-off script" should not have to author a config file before Portweave is useful. `portweave run --count 3 -- <cmd>` must work in any directory, with no `portweave.config.json` on disk, and produce a config value shaped identically to the file-loaded case so the rest of the pipeline (allocator → env → spawn) stays a single code path.

This is the doorway feature. Features 5 (allocator), 6 (env-resolution), 7 (run-command), and 9 (library-runtime) all consume its output.

## Approach

Three source files under `src/config/` plus co-located tests. The loader composes file discovery, JSON parsing, zod validation, and normalization into a single entry point that returns `Result<Config, PortweaveError>`. Anonymous mode lives in a sibling module so callers (the CLI in Feature 7) can branch on "no config file present and `--count N` supplied" without the loader sprouting flags.

### `src/config/schema.ts` — zod schema and normalized types

Define the on-disk schema with zod 4 (already a project dependency — see [package.json](../../../package.json)) and derive the normalized `Config` type from it. The schema mirrors the sample at DESIGN.md Appendix A.

Service entry fields:

- `envVar` — required string. The env-var name set to the allocated port (e.g. `API_PORT`). Validated as a conventional shell env-var identifier: `^[A-Z][A-Z0-9_]*$`.
- `preferred` — optional positive integer in `[1, 65535]`. Normalized through but **ignored by the allocator at v0** (DESIGN.md §5.1: pure machine-wide pool, no hybrid). Round-trip preservation keeps the field available for the v1 hybrid-mode revisit without re-touching this layer.
- `group` — optional non-empty string. Services sharing a `group` value are allocated as a contiguous block by Feature 5 (DESIGN.md §7.2 row #10; motivated by Kinesis 4567/4568 in [reference/boardflip/packages/shared/src/worktree-ports.ts:30](../../../reference/boardflip/packages/shared/src/worktree-ports.ts)).
- `discoveryEnv` — optional `Record<string, string>`. Each key is an env-var name, each value is a URL template containing zero or more `${serviceName}` placeholders. Templates are **preserved as raw strings**, including placeholders, with no resolution at this layer. Resolution happens in Feature 6 (env-resolution) once allocation is known.

Top-level shape:

- `$schema` — optional string, ignored at runtime (zod treats unknown keys per the schema's `.strict()` policy — see below).
- `services` — required `Record<string, ServiceSpec>`. Service names (the record keys) are validated as `^[a-z][a-z0-9-]*$` (kebab-case, must start with a letter) so they can appear inside `${...}` placeholders without escaping. Map must be non-empty.

Strictness: the top-level object and each service entry use zod's `.strict()` so unknown keys produce a precise `CONFIG_INVALID` error rather than being silently dropped (better DX, prevents typos from being ignored). `$schema` is an explicit exception — declared in the top-level schema so users can keep the IDE pointer in DESIGN.md Appendix A.

Cross-field validation (zod refinements after parse):

1. Every key referenced inside a `${...}` placeholder in any `discoveryEnv` value must exist as a service in the config. Unknown references produce `CONFIG_INVALID` with the offending placeholder name in the message.
2. A given env-var name (across both `services[*].envVar` and `services[*].discoveryEnv` keys) must be unique. Duplicates produce `CONFIG_INVALID`.
3. Each `group` label must have at least one member — trivially true since groups are declared by membership, but the normalization step (below) materializes the grouping so the allocator can iterate it directly.

Normalized output shape (exported as `Config`):

```typescript
export type ServiceSpec = {
  name: string // the record key, lifted in
  envVar: string
  preferred?: number // preserved, currently unused
  group?: string
  discoveryEnv: Record<string, string> // empty object if absent — never undefined
}

export type Config = {
  services: ServiceSpec[] // stable order = insertion order from JSON
  groups: Record<string, string[]> // groupName -> service names, derived
  source: 'file' | 'anonymous' // provenance for diagnostics
  sourcePath?: string // absolute path when source === 'file'
}
```

`services` is an array (not the on-disk record) so iteration order is stable and downstream allocator/env code can index/zip without re-deriving keys. `groups` is the inverted index over service `group` fields; services without `group` are not present in the index. Iteration order on `services` matches the JSON file's key order, which is what `JSON.parse` preserves natively for object literals.

### `src/config/loader.ts` — file discovery, parse, validate, normalize

Single exported function:

```typescript
export async function loadConfig(
  cwd: string,
  opts?: { configPath?: string },
): Promise<Result<Config, PortweaveError>>
```

Behavior:

1. **Resolve path.** If `opts.configPath` is set, resolve it against `cwd` and use it directly. Otherwise look for `portweave.config.json` in `cwd`. **No upward directory walk** at v0 — the cwd is expected to already be the worktree root by the time the loader runs (Feature 3 establishes that). Keeps semantics predictable; revisit if real users ask for it.
2. **Missing file.** Return `err(new PortweaveError(PW_ERROR_CODES.CONFIG_MISSING, ...))`. Message includes the resolved absolute path that was checked. The CLI in Feature 7 catches this specifically to gate into anonymous mode (or to surface a helpful error when `--count` wasn't supplied).
3. **Read file.** Use `fs/promises.readFile(path, 'utf8')`. Wrap in try/catch; any thrown error (permission denied, I/O failure) becomes `err(new PortweaveError(PW_ERROR_CODES.CONFIG_INVALID, ...))` with the underlying error's message included. Per [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md): catch as `unknown`, narrow with `instanceof Error` before reading `.message`.
4. **Parse JSON.** `JSON.parse` inside try/catch. Malformed JSON → `CONFIG_INVALID` with the parser's positional message included.
5. **Validate.** Run the zod schema's `.safeParse`. On failure, format the zod issue list into a single human-readable message (each issue's `path.join('.')` + `.message`, newline-joined) and return `err(PortweaveError(CONFIG_INVALID, ...))`. The path prefix makes "which field is wrong" obvious without consulting the spec author (acceptance-criteria sketch from the feature doc).
6. **Normalize.** Lift record keys into `services[*].name`, default `discoveryEnv` to `{}` when absent, materialize the `groups` inverted index, set `source: 'file'` and `sourcePath` to the absolute resolved path. Return `ok(normalized)`.

No exceptions leak: every fallible step is caught and converted to a typed `Result`. Loader is `async` so it composes cleanly with the library-runtime path in Feature 9, which is async per its own spec.

### `src/config/anonymous.ts` — zero-config synthesis

Single exported function:

```typescript
export function synthesizeAnonymousConfig(
  count: number,
): Result<Config, PortweaveError>
```

Behavior:

- Validates `count` is an integer in `[1, 100]`. Out-of-range or non-integer returns `err(PortweaveError(CONFIG_INVALID, ...))` with a message naming the constraint. Upper bound of 100 prevents accidental pool exhaustion at the allocator layer and matches boardflip's de-facto 99-offset historical cap (DESIGN.md §4: "99-offset cap → no cap" applies to the per-worktree pool, but a single anonymous invocation asking for hundreds of ports is almost certainly a bug).
- Returns a normalized `Config` with `count` synthetic services named `port-1`, `port-2`, ..., `port-N` (kebab-case so they satisfy the service-name pattern). Each service's `envVar` is `PORT_1`, `PORT_2`, ..., `PORT_N`. `preferred`, `group`, `discoveryEnv` are all absent / empty.
- `source: 'anonymous'`, `sourcePath` undefined. `groups` is `{}`.
- The returned shape is **structurally identical** to a file-loaded `Config`. The allocator, env-resolver, and CLI cannot tell the two apart from shape alone — only by inspecting the `source` discriminant for diagnostic banners.

Synchronous (no I/O), unlike `loadConfig`. Callers that want a uniform async surface can `await Promise.resolve(synthesizeAnonymousConfig(n))` at the call site.

### `src/config/index.ts` — module barrel

Named re-exports of `loadConfig`, `synthesizeAnonymousConfig`, and the public types (`Config`, `ServiceSpec`). Keeps Feature 7's CLI import to a single line: `import { loadConfig, synthesizeAnonymousConfig } from './config/index.ts'`.

### Tests under `src/config/__tests__/`

Three test files, one per source file (matches `structure:check` enforcement):

- `schema.test.ts` — covers schema-level validation only, using direct `.safeParse` calls against fixture objects. Includes:
  - DESIGN.md Appendix A sample parses successfully and produces the expected normalized shape (all 8 services present, Kinesis pair share a group, ws and api have `discoveryEnv` populated).
  - Unknown top-level key (other than `$schema`) → validation failure.
  - Unknown key inside a service entry → validation failure.
  - `envVar` not matching `^[A-Z][A-Z0-9_]*$` → validation failure.
  - Service-name key not matching `^[a-z][a-z0-9-]*$` → validation failure.
  - `discoveryEnv` value referencing an unknown service via `${nope}` → validation failure naming `nope`.
  - Duplicate env-var name across two services → validation failure naming the duplicated identifier.
  - Empty `services` map → validation failure.
  - `preferred` outside `[1, 65535]` → validation failure.

- `loader.test.ts` — exercises the loader end-to-end against real I/O in `node:os.tmpdir()` per [.claude/rules/testing.md](../../../.claude/rules/testing.md). No mocks of `fs`. Includes:
  - Happy path: write a valid config to a temp dir, call `loadConfig(tmpdir)`, assert `result.ok === true` and the normalized fields.
  - Missing file: empty temp dir → `result.ok === false`, `result.error.code === 'PW0101'` (CONFIG_MISSING), message contains the resolved absolute path.
  - Malformed JSON: write `{ "services": ` (truncated) → `result.ok === false`, `result.error.code === 'PW0102'` (CONFIG_INVALID).
  - Schema-invalid config: write a config with an unknown top-level field → `CONFIG_INVALID`, message contains the offending field path.
  - Explicit `configPath` option: write the file under a non-default name, pass `configPath: 'custom.json'`, assert it loads.
  - Permission failure simulation: write the file with mode `0o000`, attempt to read → `CONFIG_INVALID` (covers the catch-block path; restore permissions in `afterEach`).
  - `source: 'file'` and `sourcePath` are set to the absolute resolved path.

- `anonymous.test.ts` — pure-function tests, no I/O. Includes:
  - `synthesizeAnonymousConfig(3)` produces 3 services named `port-1..3` with env vars `PORT_1..3`.
  - `synthesizeAnonymousConfig(0)`, `(-1)`, `(1.5)`, `(101)` all return `CONFIG_INVALID`.
  - Returned shape passes the same zod schema as a file-loaded config when reverse-validated (structural-interchangeability guarantee).
  - `source === 'anonymous'`, `sourcePath` undefined, `groups` is `{}`.

Coverage threshold of 80% (per [vitest.shared.ts](../../../vitest.shared.ts)) is reachable with these tests; the loader's branch coverage is the tightest constraint, addressed by the five failure-path tests above.

### Error codes used

The seed codes from [src/errors.ts](../../../src/errors.ts) cover this feature without additions:

- `PW0101` `CONFIG_MISSING` — no `portweave.config.json` at the resolved path.
- `PW0102` `CONFIG_INVALID` — read failure, JSON parse failure, schema-validation failure, anonymous-mode arg violation.

A future feature can subdivide `CONFIG_INVALID` into more granular codes (`PW0103+`) if downstream callers need to dispatch on the specific failure mode. v0 callers (CLI in Feature 7) only need to distinguish "no file" from "file present but unusable" — `CONFIG_MISSING` vs `CONFIG_INVALID` suffices.

## Acceptance criteria

- [ ] `src/config/schema.ts`, `src/config/loader.ts`, `src/config/anonymous.ts`, and `src/config/index.ts` exist with the exports described in the Approach section.
- [ ] The sample config in DESIGN.md Appendix A parses cleanly via `loadConfig`, returns `ok`, and the normalized `services` array contains exactly the eight entries (`api`, `ws`, `vite`, `dynamodb`, `dynamodb-admin`, `kinesis`, `kinesis-tls`, `ses`) with their `envVar`, `preferred`, `group`, and `discoveryEnv` fields preserved verbatim (verified in `loader.test.ts`).
- [ ] `loadConfig(cwd)` against an empty temp directory returns `err` with `error.code === PW_ERROR_CODES.CONFIG_MISSING` (`'PW0101'`); the error message contains the absolute path that was checked.
- [ ] `loadConfig(cwd)` against a directory containing malformed JSON, schema-invalid JSON, or an unreadable file returns `err` with `error.code === PW_ERROR_CODES.CONFIG_INVALID` (`'PW0102'`) and the error message names the offending field (for schema failures) or includes the underlying parser/IO message (for JSON/IO failures).
- [ ] An `envVar` not matching `^[A-Z][A-Z0-9_]*$`, a service-name key not matching `^[a-z][a-z0-9-]*$`, an unknown top-level key (other than `$schema`), an unknown key inside a service entry, a `discoveryEnv` template referencing an undeclared service, two services declaring the same `envVar`, an empty `services` map, or a `preferred` value outside `[1, 65535]` each produce `CONFIG_INVALID` with a path-prefixed message identifying the offending field (verified in `schema.test.ts`).
- [ ] `discoveryEnv` template values round-trip through the loader as raw strings — their `${serviceName}` placeholders are present unchanged in the normalized `Config.services[i].discoveryEnv` map (no resolution at this layer).
- [ ] `synthesizeAnonymousConfig(n)` for `n` in `[1, 100]` returns `ok` with a `Config` whose `services` array has length `n`, names `port-1..port-n`, env vars `PORT_1..PORT_n`, `source === 'anonymous'`, `sourcePath` undefined, and `groups === {}`.
- [ ] `synthesizeAnonymousConfig(n)` for `n <= 0`, non-integer `n`, or `n > 100` returns `err` with `error.code === PW_ERROR_CODES.CONFIG_INVALID` and a message naming the constraint.
- [ ] A `Config` produced by `synthesizeAnonymousConfig` re-validates successfully against the zod schema in `schema.ts` — structural interchangeability with file-loaded configs (verified in `anonymous.test.ts`).
- [ ] The `groups` inverted index in a normalized `Config` maps each group label to an array of service names in source-order; services without a `group` are absent from the index (verified against DESIGN.md Appendix A: `groups.dynamodb === ['dynamodb', 'dynamodb-admin']`, `groups.kinesis === ['kinesis', 'kinesis-tls']`).
- [ ] All file I/O in `loader.test.ts` uses real temp directories under `node:os.tmpdir()`; no `vi.mock('fs')`, `vi.mock('node:fs')`, or `vi.mock('node:fs/promises')` calls appear (matches [.claude/rules/testing.md](../../../.claude/rules/testing.md): "Lean toward real I/O").
- [ ] `npm run dev-workflow` is green at the end of the feature, with `test` coverage meeting the 80% threshold across the four new source files and `structure:check` passing (every new test file has a matching source file at `../`).
- [ ] No source file in `src/config/` throws on the documented failure paths — every fallible function returns `Result<T, PortweaveError>`. The only `throw` permitted is for genuine invariant violations (e.g. internal helper called with impossible input); none of the public API surfaces such an invariant.

## Open questions

None blocking implementation. The three open questions from the feature doc are pre-resolved per the v0 roadmap and baked into Approach:

- `preferred` is normalized through but ignored by the allocator at v0 (DESIGN.md §5.1; revisit at v1 hybrid-mode).
- Config-file discovery is `portweave.config.json` only at v0 — no `.portweaverc`, no `package.json#portweave`, no upward directory walk.
- Validation library is zod (existing dependency).

If a question surfaces during review (e.g. whether the anonymous-mode upper bound should differ from 100, or whether the service-name regex should permit underscores), update Approach and the matching acceptance criteria before promoting `Status: approved`.
