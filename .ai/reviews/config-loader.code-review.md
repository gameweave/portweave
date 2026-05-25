---
title: 'Config Loader and Anonymous Mode'
source: '.ai/specs/config-loader/config-loader.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-24
reviewer: code-review-subagent
---

# Code Review: Config Loader and Anonymous Mode

## Summary

The config-loader implementation is correct, complete, and well-structured. All four source files exist with the exports the spec requires; the normalized `Config` shape, cross-field validation, anonymous-mode synthesis, and file-loading pipeline all match the spec. Three minor issues were found: a thin Appendix-A assertion in `schema.test.ts`, a missing root-user guard in the permission-failure test, and a cross-cutting gap where the config module's public types are not re-exported from `src/index.ts` (the main library barrel). No logic errors or spec deviations were found.

## Source

- **Spec:** `.ai/specs/config-loader/config-loader.md`
- **Feature doc:** `.ai/features/config-loader/config-loader.md`
- **Branch:** `jl/build-specs`
- **Files reviewed:** 7 (4 source, 3 test)
- **Changes analyzed:** `src/config/schema.ts`, `src/config/loader.ts`, `src/config/anonymous.ts`, `src/config/index.ts` + co-located tests

## Accuracy Assessment

| Requirement                                                                                             | Status         | Notes                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `schema.ts` — zod schema with `.strict()` on top-level and service entries                              | ✅ Implemented | `z.strictObject` used on both `configFileSchema` and `serviceEntrySchema`                              |
| `$schema` escape hatch as explicit top-level field                                                      | ✅ Implemented | Declared in schema, tested in `schema.test.ts:231`                                                     |
| `envVar` validated as `^[A-Z][A-Z0-9_]*$`                                                               | ✅ Implemented | `ENV_VAR_PATTERN` applied via `envVarSchema`; shared for both service `envVar` and `discoveryEnv` keys |
| `preferred` optional positive integer in `[1, 65535]`                                                   | ✅ Implemented | `z.int().min(1).max(65535)` — uses zod 4 API                                                           |
| `group` optional non-empty string                                                                       | ✅ Implemented | `z.string().min(1)`                                                                                    |
| `discoveryEnv` keys validated as env-var identifiers                                                    | ✅ Implemented | `z.record(envVarSchema, z.string())`                                                                   |
| Service names validated as `^[a-z][a-z0-9-]*$`                                                          | ✅ Implemented | `SERVICE_NAME_PATTERN` on `z.record` key                                                               |
| `services` must be non-empty                                                                            | ✅ Implemented | `.refine()` with `{ error: ... }` (valid zod 4 API)                                                    |
| Cross-field: `discoveryEnv` template placeholders reference only declared services                      | ✅ Implemented | `checkDiscoveryEnv` + `collectPlaceholders`                                                            |
| Cross-field: env-var names unique across services and discoveryEnv keys                                 | ✅ Implemented | `checkCrossFieldRules` via `ctx.seen` map                                                              |
| Normalized `Config` shape with `services[]`, `groups{}`, `source`, `sourcePath?`                        | ✅ Implemented | `normalize()` in `schema.ts`                                                                           |
| `discoveryEnv` defaults to `{}` (never undefined in output)                                             | ✅ Implemented | `entry.discoveryEnv ?? {}` in `normalize()`                                                            |
| `groups` is inverted index; services without group absent                                               | ✅ Implemented | Correct loop in `normalize()`                                                                          |
| `loadConfig(cwd, opts?)` returns `Promise<Result<Config, PortweaveError>>`                              | ✅ Implemented | Exact signature match                                                                                  |
| Missing file → `CONFIG_MISSING` with absolute path in message                                           | ✅ Implemented | ENOENT detection in `readConfigFile`                                                                   |
| Read failure → `CONFIG_INVALID` with underlying message                                                 | ✅ Implemented | Catch block in `readConfigFile`                                                                        |
| Malformed JSON → `CONFIG_INVALID` with parser message                                                   | ✅ Implemented | `parseJson()` catch block                                                                              |
| Schema-invalid → `CONFIG_INVALID` with path-prefixed field names                                        | ✅ Implemented | `formatZodIssues()` uses `issue.path.join('.')`                                                        |
| Explicit `configPath` option (relative and absolute)                                                    | ✅ Implemented | `resolveConfigPath()` handles both; three tests cover it                                               |
| No upward directory walk                                                                                | ✅ Implemented | Only `cwd` + filename joined                                                                           |
| `synthesizeAnonymousConfig(n)` — sync, returns `Result<Config, PortweaveError>`                         | ✅ Implemented |                                                                                                        |
| Names `port-1..port-N`, env vars `PORT_1..PORT_N`                                                       | ✅ Implemented |                                                                                                        |
| Count validated as integer in `[1, 100]`                                                                | ✅ Implemented | `Number.isInteger` + bounds check                                                                      |
| Anonymous `Config` structurally identical to file-loaded                                                | ✅ Implemented | `source: 'anonymous'`, `groups: {}`, no `sourcePath`                                                   |
| `src/config/index.ts` barrel exports `loadConfig`, `synthesizeAnonymousConfig`, `Config`, `ServiceSpec` | ✅ Implemented |                                                                                                        |
| All fallible public functions return `Result`, no throws on documented failure paths                    | ✅ Implemented | No public throws found                                                                                 |
| No `vi.mock('fs')` / `vi.mock('node:fs/promises')` in loader tests                                      | ✅ Implemented | Real I/O against `tmpdir()`                                                                            |

## Completeness Assessment

### Implemented

- `src/config/schema.ts` — full zod schema, cross-field validation, normalization, `validateAndNormalizeConfig` export
- `src/config/loader.ts` — file discovery, read, parse, validate pipeline
- `src/config/anonymous.ts` — count-validated synthetic config generator
- `src/config/index.ts` — barrel re-exporting `loadConfig`, `synthesizeAnonymousConfig`, `Config`, `ServiceSpec`, `LoadConfigOptions`
- `src/config/__tests__/schema.test.ts` — 19 test cases covering shape, strict unknowns, cross-field refinements, and Appendix A
- `src/config/__tests__/loader.test.ts` — 9 test cases covering happy path, all failure paths, configPath variants
- `src/config/__tests__/anonymous.test.ts` — 6 test cases including boundary values and structural interchangeability
- `package.json` — `zod ^4.4.3` added as a runtime dependency
- `knip.json` — `src/config/index.ts` added as a knip entry point

### Missing or Incomplete

- **`src/index.ts` re-export:** The main library barrel does not re-export `loadConfig`, `synthesizeAnonymousConfig`, `Config`, or `ServiceSpec`. The spec does not explicitly require this at the spec level (it defers to Feature 7's import path), but it is architecturally inconsistent — the config module is a first-class feature yet is invisible from the library's public surface. See MI-2 below (cross-cutting).

### Beyond Scope

- `validateAndNormalizeConfig` and `NormalizationContext` are exported from `src/config/schema.ts` and used directly in tests. The spec describes `validateAndNormalizeConfig` as the internal composition entry point, but exporting it makes it part of the module's contract. This isn't wrong — the tests need it — but it's a surface that downstream callers could reach outside the `src/config/index.ts` barrel. Low risk at v0 given no external consumers exist yet.
- `knip.json` was updated to add `src/config/index.ts` as a second entry point rather than routing the config exports through `src/index.ts`. This prevents deadcode false-positives but deviates from the single-barrel convention other modules follow. See MI-2.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: `schema.test.ts` Appendix A test checks service-name presence only, not `groups`, `envVar`, `preferred`, or `discoveryEnv` fields — `src/config/__tests__/schema.test.ts:56`
  - **Suggested fix:** Extend the existing "accepts DESIGN.md Appendix A" test to assert `result.value.groups`, at minimum checking `groups.dynamodb` and `groups.kinesis`, plus that `api` and `ws` have populated `discoveryEnv`. The spec says the test should verify "Kinesis pair share a group, ws and api have `discoveryEnv` populated" (spec §Tests, line 115). The `loader.test.ts` covers groups and full field preservation for Appendix A, so this is partially mitigated, but the spec says it should also be in `schema.test.ts`.

- **MI-2**: `loadConfig`, `synthesizeAnonymousConfig`, `Config`, `ServiceSpec` are not re-exported from `src/index.ts`; `knip.json` works around this by listing `src/config/index.ts` as a separate entry — `src/index.ts` (cross-cutting)
  - **Suggested fix:** Add `export { loadConfig, synthesizeAnonymousConfig, type Config, type ServiceSpec } from './config/index.ts'` to `src/index.ts` and remove `src/config/index.ts` from `knip.json`'s entry array. The spec notes this module is "the doorway feature" for all downstream work; hiding it from the library barrel makes it awkward for Feature 9 (library-runtime) callers.

### 🟢 Suggestions

- **S-1**: The permission-failure test in `loader.test.ts` guards against `process.platform === 'win32'` but does not guard against running as root (where `chmod 0o000` has no effect) — `src/config/__tests__/loader.test.ts:188`
  - **Rationale:** CI pipelines running as `root` (common in Docker containers) would pass a `chmod 0o000` file to `readFile` successfully, causing the test to fail by returning `ok: true` instead of `err`. Add `process.getuid?.() === 0` as a second skip condition: `if (process.platform === 'win32' || process.getuid?.() === 0) { return }`.

- **S-2**: `outcome.contents ?? ''` at `loader.ts:87` is a defensive fallback that is unreachable given the preceding `missing` and `problem` guards. The `ReadOutcome` interface could be narrowed to a discriminated union to make TypeScript enforce this statically, eliminating the need for the fallback — `src/config/loader.ts:27`
  - **Rationale:** The `ReadOutcome` interface with three optional fields is not self-documenting about mutual exclusivity. A tagged union (`{ tag: 'ok'; contents: string } | { tag: 'missing' } | { tag: 'error'; problem: PortweaveError }`) would make the exhaustiveness obvious and remove the `?? ''` escape hatch.

## Potential Issues

- **P-1**: `JSON.parse` preserves object-key insertion order as a native V8 behaviour, and the spec relies on this for stable `services` array ordering. This is reliable in all current V8 / Node.js 24 versions but is not guaranteed by the ECMAScript spec for integer-like keys — `src/config/schema.ts:146`
  - **Risk:** Service names that are numeric strings (e.g. `"1"`, `"42"`) would be sorted numerically by V8 rather than in insertion order, breaking the spec's "stable order = insertion order from JSON" guarantee. The service-name regex `^[a-z][a-z0-9-]*$` already prevents purely-numeric names (must start with a lowercase letter), so this is not exploitable with the current validation. No action required, but worth a comment noting the regex is load-bearing for order stability.

- **P-2**: Cross-field uniqueness check (`checkCrossFieldRules`) iterates `Object.entries(raw.services)` in insertion order. If two services simultaneously declare the same `envVar`, the error message names only the second occurrence vs the first. This is correct but iterates the service list once per service — O(n) per service entry for the seen-map lookup, which is fine for any realistic config size.
  - **Risk:** None at realistic scale; noted for completeness.

## Code Quality

### Patterns & Consistency

The code is consistent with Portweave conventions throughout. `Result<T, E>` is used for all fallible paths; no public function throws on documented failure modes. Helper extraction into `recordEnvVar`, `checkDiscoveryEnv`, `collectPlaceholders`, and `parseJson` keeps cyclomatic complexity low. The `ReadOutcome` intermediate type in `loader.ts` is a reasonable design choice for separating ENOENT from other I/O errors without nesting try/catch. Naming is clear and file-extension imports are correct throughout.

### Error Handling

All catch variables are typed `unknown` and narrowed before property access (`caught instanceof Error`, or the `describe()` helper that safely falls back to `String(caught)`). No silent swallows — the `// pw-allow-swallow: best-effort restore so rm can clean the tempdir` comment in `loader.test.ts:79` is correctly justified. `PortweaveError` in `src/errors.ts` has `Object.setPrototypeOf` (pre-existing, cross-cutting). The `Result` contract is respected by all public functions.

### Type Safety

No `any` types. `import type` is used correctly: `import type { Config, ServiceSpec } from './schema.ts'` in `anonymous.ts`, `import { type Config, ... }` in `loader.ts` and `index.ts`. All relative imports include `.ts` extensions. `verbatimModuleSyntax` compliance is correct.

### Test Coverage

19 + 9 + 6 = 34 test cases across the three test files. All documented failure paths have a test. The structural-interchangeability test in `anonymous.test.ts` (re-validating anonymous output against the zod schema) is a particularly good cross-layer assertion. The `it.each` pattern for out-of-range counts is clean and covers `NaN` and `Infinity` — inputs the spec's acceptance criteria don't name explicitly but are correctly handled by `Number.isInteger`. The main gap is the thin Appendix A assertion in `schema.test.ts` (MI-1).

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 2     |
| 🟢 Suggestions      | 2     |
| ⚠️ Potential Issues | 2     |

### Required Actions

None — no issues block ship.

### Recommended Actions

1. Address MI-1: Extend `schema.test.ts` Appendix A test to assert `groups` and `discoveryEnv` population, per spec §Tests requirement.
2. Address MI-2: Re-export config module types from `src/index.ts` and remove `src/config/index.ts` from `knip.json` entry list, to keep the library barrel consistent.
3. Address S-1: Add root-user skip guard to the permission-failure test in `loader.test.ts`.
