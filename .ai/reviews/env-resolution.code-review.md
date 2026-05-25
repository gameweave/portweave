---
title: 'Code Review: Env-var resolution and .portweave/current.env writer'
source: '.ai/specs/env-resolution/env-resolution.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: code-review-subagent
---

# Code Review: Env-var resolution and .portweave/current.env writer

## Summary

The env-resolution feature is implemented correctly and faithfully against the
spec. All five source files (`build.ts`, `templates.ts`, `dotenv-merge.ts`,
`writer.ts`, `resolve.ts`) and five test files exist at the specified paths,
and the public surface (`index.ts`) re-exports exactly what the spec requires.
Error handling follows Portweave conventions throughout: `Result<T, E>` for
fallible I/O, `throw` for invariant violations, and `pw-allow-swallow` comments
for the two legitimate swallows in `writer.ts`. The most significant finding is
that `resolve.ts` has a branch coverage gap in the rethrow path, and the
`DOTENV_LINE_PATTERN` regex accepts inline comments (e.g., `KEY=value #
comment`) rather than treating them as malformed.

## Source

- **Spec:** `.ai/specs/env-resolution/env-resolution.md`
- **Feature doc:** `.ai/features/env-resolution/env-resolution.md`
- **Branch:** `jl/v0-layer-3-6`
- **Files reviewed:** 11 (5 source + 5 test + `src/errors.ts`, `src/index.ts`,
  `src/__tests__/errors.test.ts`)
- **Changes analyzed:** New `src/env/` module; two new PW error codes; public
  surface wired through `src/index.ts`

## Accuracy Assessment

| Requirement                                                                                    | Status         | Notes                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `resolveEnv(allocation, config, projectRoot)` → `Promise<Result<ResolvedEnv, PortweaveError>>` | ✅ Implemented | `src/env/resolve.ts` — exact signature                                                                      |
| `buildEnvMap(allocation, config)` pure, one entry per `envVar` + discovery                     | ✅ Implemented | `src/env/build.ts` — guards with `Object.hasOwn`, throws PW0501 on drift                                    |
| `evaluateTemplate` substitutes `${serviceName}` with port                                      | ✅ Implemented | `src/env/templates.ts` — uses `replaceAll` with `PLACEHOLDER_PATTERN`                                       |
| Multi-placeholder templates supported                                                          | ✅ Implemented | Tested in `templates.test.ts`                                                                               |
| `readDotenvFile` returns `ok({})` when file missing                                            | ✅ Implemented | `dotenv-merge.ts:53-60`                                                                                     |
| `readDotenvFile` parses `KEY=value`, quoted, comments, blanks                                  | ✅ Implemented | `dotenv-merge.ts` — full parser                                                                             |
| `readDotenvFile` returns `err(PW0502)` on malformed lines                                      | ✅ Implemented | `dotenv-merge.ts:21-28`                                                                                     |
| `applyDotenvOverrides` drops dotenv-only keys                                                  | ✅ Implemented | `dotenv-merge.ts:81-91`                                                                                     |
| `ensurePortweaveDir` creates dir + `.gitignore` with `*\n` on first run                        | ✅ Implemented | `writer.ts:31-72`                                                                                           |
| `.gitignore` not overwritten on subsequent calls                                               | ✅ Implemented | `wx` flag prevents clobber; idempotent test passes                                                          |
| `atomicWriteDotenv` write via tempfile + rename                                                | ✅ Implemented | `writer.ts:74-82` — mirrors `atomic-write.ts`                                                               |
| `serializeDotenv` sorted ascending, quoting for special chars                                  | ✅ Implemented | `writer.ts:15-29`                                                                                           |
| `resolveEnv` wraps `buildEnvMap` throw in try/catch → `Result`                                 | ✅ Implemented | `resolve.ts:25-32`                                                                                          |
| Two new PW codes: `ENV_BUILD_INVALID=PW0501`, `ENV_DOTENV_PARSE_FAILED=PW0502`                 | ✅ Implemented | `src/errors.ts`                                                                                             |
| `src/env/index.ts` re-exports `resolveEnv`, `buildEnvMap`, `evaluateTemplate`, `ResolvedEnv`   | ✅ Implemented | `src/env/index.ts`                                                                                          |
| Spec test layout: 5 test files in `src/env/__tests__/`                                         | ✅ Implemented | All 5 files present                                                                                         |
| Appendix A config + Appendix B allocation → exact Appendix B env vars                          | ✅ Implemented | `build.test.ts` verifies all 12 vars                                                                        |
| End-to-end integration: `API_PORT` override + `VITE_API_URL` from allocated port               | ✅ Implemented | `resolve.test.ts` — spec's exact scenario                                                                   |
| Decision-log rows to append on ship                                                            | ⚠️ Partial     | Spec requires 3 rows appended on `Status: shipped`; spec is still `in-progress` at review time — acceptable |

## Completeness Assessment

### Implemented

- `src/env/build.ts` — `buildEnvMap`, uses `Object.hasOwn` to guard PW0501
- `src/env/templates.ts` — `evaluateTemplate` with correct `PLACEHOLDER_PATTERN`
- `src/env/dotenv-merge.ts` — `readDotenvFile` + `applyDotenvOverrides`
- `src/env/writer.ts` — `serializeDotenv`, `ensurePortweaveDir`, `atomicWriteDotenv`
- `src/env/resolve.ts` — `resolveEnv` composition function with `ResolvedEnv` interface
- `src/env/index.ts` — thin re-export surface
- `src/errors.ts` — `ENV_BUILD_INVALID='PW0501'` and `ENV_DOTENV_PARSE_FAILED='PW0502'`
- `src/__tests__/errors.test.ts` — updated to include the two new codes
- `src/index.ts` — env surface exported so knip can trace it
- All 5 test files covering 44 tests total, all passing

### Missing or Incomplete

- Decision-log rows: 3 rows need to be appended when spec is marked `shipped`
  (this is a ship-step action, not a code gap)

### Beyond Scope

- `src/index.ts` exports `buildEnvMap` and `evaluateTemplate` in addition to
  `resolveEnv` and `ResolvedEnv`. The spec's public-surface section lists these
  as part of `src/env/index.ts`'s re-exports; surfacing them through
  `src/index.ts` is a reasonable discoverability choice but goes slightly beyond
  what the spec explicitly requires. Not a concern.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: `DOTENV_LINE_PATTERN` accepts inline comments as part of unquoted
  values — `API_PORT=3001 # some comment` parses as key=`API_PORT`,
  value=`3001 # some comment`. The spec says the parser supports `# comments at
start of line`; inline comments are out of scope. The current behavior writes
  `API_PORT=3001 # some comment` to `.portweave/current.env`, which will cause
  consumers (dotenv-parse libraries) to fail unless they also strip inline
  comments. Since we only read (and immediately re-serialize with our own
  `serializeDotenv`), the written file will contain the raw comment text in the
  value, which is incorrect. — `src/env/dotenv-merge.ts:7`
  - **Suggested fix:** This is a known v0 limitation; the spec explicitly notes
    the minimal parser. Add a test or comment documenting that inline comments
    are not stripped from unquoted values, so a future contributor adding
    `dotenv-expand` support doesn't miss this edge case. No code change
    required to pass, but it's worth a `// pw-todo:` comment marking the gap.

- **MI-2**: `resolve.ts` branch coverage is at ~25% for branches — the `throw
caught` path in the catch block (non-`PortweaveError` rethrow at line 31) is
  never exercised by a test. In practice `buildEnvMap` only throws
  `PortweaveError`, so this path is unreachable without injecting a mock, but it
  represents an untested rethrow path. — `src/env/resolve.ts:31`
  - **Suggested fix:** Either accept the gap as theoretical (document with a
    comment), or add a test that passes a config designed to make `evaluateTemplate`
    throw a non-PortweaveError (hard without mocking). No code change required to
    pass.

### 🟢 Suggestions

- **S-1**: `writer.ts:23` — `env[key]` is accessed without a type assertion
  after the `knip`-passing update. The value is used as `string` but TypeScript
  could infer `string | undefined` under strict `noUncheckedIndexedAccess` (not
  currently enabled). Using `env[key] as string` explicitly or using
  `Object.entries` (which gives the value typed as `string`) would be more
  forward-proof. Currently correct since `keys = Object.keys(env)`.
  - **Rationale:** If `noUncheckedIndexedAccess` is ever enabled (a reasonable
    strict-mode upgrade), this line would need a change anyway; flagging
    pre-emptively.

- **S-2**: `dotenv-merge.ts` — The `match[3]` access for the inner value
  content relies on the regex group ordering. A brief comment mapping
  group numbers (`match[1]` = key, `match[2]` = quote char, `match[3]` =
  inner content) would make the regex logic easier to maintain without
  running through the regex mentally. — `src/env/dotenv-merge.ts:30-41`
  - **Rationale:** Low friction to add, high readability value.

## Potential Issues

- **P-1**: `ensurePortweaveDir` uses two sequential `access` + `mkdir` calls
  with a TOCTOU window between checking directory existence and writing
  `.gitignore`. Under concurrent first-run invocations (two simultaneous
  `portweave run` in the same project root), both could set
  `dirAlreadyExisted = false`, both write to the temp path via `wx`, and one
  would win silently. The `wx` flag and the inner try/catch swallow handle this
  correctly. Flagging as a potential issue because the TOCTOU comment isn't
  explicit about why the race is safe. — `src/env/writer.ts:38-52`
  - **Risk:** If the `wx` flag ever behaves differently on non-POSIX filesystems
    (e.g., some network mounts), the inner swallow could silently fail to write
    the `.gitignore`.
  - **Recommendation:** The existing `pw-allow-swallow` comments are sufficient;
    consider adding a note that `wx` provides the atomicity guarantee.

- **P-2**: `atomicWriteDotenv` uses `process.pid` + `Date.now()` for the temp
  file name. If called twice within the same millisecond from the same process
  (possible in tests), the two temp paths would collide. The `rename` is atomic
  so the file content would still be correct, but the second write's temp file
  might clobber the first's before the first rename completes. — `src/env/writer.ts:78`
  - **Risk:** Practically benign since each `resolveEnv` call is async and callers
    await it, but theoretically an issue if `atomicWriteDotenv` is ever called
    without awaiting.
  - **Recommendation:** Add a monotonic counter suffix (e.g.,
    `${process.pid}-${Date.now()}-${counter++}`) for defense in depth, matching
    what `atomic-write.ts` already does. Or document the assumption that callers
    always await.

## Code Quality

### Patterns & Consistency

The implementation is consistent with Portweave's existing patterns throughout.
`Result<T, E>` is used for fallible I/O (`readDotenvFile`, `resolveEnv`); pure
functions `buildEnvMap` and `evaluateTemplate` throw `PortweaveError` for
invariant violations per the error-handling contract. `Object.hasOwn` is used
correctly as a workaround for the TypeScript `Record<string, number>` indexing
limitation (where `=== undefined` would trip the `no-unnecessary-condition`
lint rule). The `Object.setPrototypeOf` pattern is present on `PortweaveError`
(in the existing `errors.ts`), and the new error codes follow the `PW05xx`
block per decision-log row #17.

Import organization follows `verbatimModuleSyntax` (`import type` for
type-only imports, `.ts` extensions on relative imports).

### Error Handling

All catch variables are typed `unknown` and narrowed before use.
`dotenv-merge.ts:52-61` correctly narrows with `typeof caught === 'object' &&
caught !== null && 'code' in caught` before accessing `.code`. `resolve.ts`
correctly catches from `buildEnvMap` and re-throws non-`PortweaveError`
exceptions. Three `// pw-allow-swallow:` comments in `writer.ts` are all
legitimate (two for concurrent `.gitignore` creation, one for the `access`
check that determines directory pre-existence).

### Type Safety

No new `any` types. Type imports use `import type` where appropriate.
All relative imports include `.ts` extensions. The `PortweaveError as
PortweaveErrorType` re-export alias in `resolve.ts` handles the TypeScript
constraint where you can't both import and export the same name — resolved
correctly.

### Test Coverage

44 tests across 5 files; all pass. Per-file coverage for `src/env/`:

- `build.ts`: covered fully by `build.test.ts` (3 tests)
- `templates.ts`: covered fully by `templates.test.ts` (6 tests)
- `dotenv-merge.ts`: ~97% statements, ~95% branches (9 + 4 tests)
- `writer.ts`: ~93% statements, 100% branches (3 + 3 + 9 tests)
- `resolve.ts`: ~71% statements, ~25% branches — low branch coverage due to
  the rethrow path (see MI-2)

The end-to-end integration test (`resolve.test.ts`) correctly verifies the key
spec behavior: `API_PORT` override from `.env` wins while `VITE_API_URL` still
uses the allocated port (not the overridden value). This is the most
spec-critical behavior and it's tested.

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

None — no Critical or Major issues found.

### Recommended Actions

1. Address MI-1: Add a comment or test documenting that inline comments in
   unquoted `.env` values are not stripped at v0.
2. Address MI-2: Add a comment or minimal test acknowledging the rethrow
   path in `resolve.ts:31` is unreachable in practice.
3. Address P-1: Clarify in a comment that `wx` + swallow is the concurrency
   safety mechanism for `.gitignore` creation.
4. Address P-2: Consider adding a monotonic counter to the temp file name in
   `atomicWriteDotenv`, matching `atomic-write.ts`'s naming, or document the
   await-assumption.
