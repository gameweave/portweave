---
title: 'Code Review: portweave/runtime library API'
source: '.ai/specs/library-runtime/library-runtime.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: code-review-subagent
---

# Code Review: portweave/runtime library API

## Summary

The library-runtime spec is implemented faithfully and completely. `src/runtime/index.ts` exposes the three required async functions (`ports`, `env`, `allocation`) as a thin facade over the existing allocator+env-resolution stack. The upward-walk config discovery is correctly extracted into `src/runtime/upward-walk.ts`. Error passthrough, anonymous fallback, and `.portweave/current.env` side-effect behavior all match spec intent. The test suite covers the major acceptance criteria. The dev-workflow is green. Two minor findings and one suggestion are noted; none are blocking.

## Source

- **Spec:** `.ai/specs/library-runtime/library-runtime.md`
- **Feature doc:** `.ai/features/library-runtime/library-runtime.md`
- **Branch:** `jl/exec-library-runtime`
- **Files reviewed:** 12
- **Changes analyzed:** New `src/runtime/` module with 4 source files and 4 test files; `src/errors.ts` additions; `package.json` exports; `knip.json` updates; `tsconfig.build.json` addition; `src/__tests__/errors.test.ts` update

## Accuracy Assessment

| Requirement                                                                                                      | Status         | Notes                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `src/runtime/index.ts` exports `ports()`, `env()`, `allocation()` returning `Promise<Result<T, PortweaveError>>` | ✅ Implemented | All three match spec signatures exactly                                        |
| `PortsOptions` interface with exactly `cwd`, `configPath`, `count` (all optional, readonly)                      | ✅ Implemented | `src/runtime/index.ts:16-23`                                                   |
| No imports from `src/cli.ts` or `src/cli/`                                                                       | ✅ Implemented | Only imports from `config`, `allocator`, `env`, `worktree`, `errors`, `result` |
| `ports()` returns port map matching exactly the service names in config                                          | ✅ Implemented | Verified by `index.test.ts`                                                    |
| `env()` returns string map with all `envVar` and `discoveryEnv` keys                                             | ✅ Implemented | Verified including discovery URL test                                          |
| `allocation()` returns full `Allocation` with `key.worktreeRoot`                                                 | ✅ Implemented | Verified by `index.test.ts`                                                    |
| Upward-walk config discovery from subdirectory                                                                   | ✅ Implemented | `findConfigUpward` in `upward-walk.ts`                                         |
| Walk stops at filesystem root when no config found                                                               | ✅ Implemented | `parent === dir` check at line 22                                              |
| Explicit `opts.configPath` resolves against `opts.cwd` and bypasses walk                                         | ✅ Implemented | `resolveConfigForRuntime` lines 36-45                                          |
| Anonymous fallback with `opts.count` synthesizes config and writes `.env`                                        | ✅ Implemented | Tested in `index.test.ts`                                                      |
| No-config-no-count returns `PW0701`                                                                              | ✅ Implemented | Error message includes `cwd` path                                              |
| Every successful call writes `.portweave/current.env`                                                            | ✅ Implemented | Via `resolveEnv` which calls `atomicWriteDotenv`                               |
| Two parallel `ports()` calls serialize correctly                                                                 | ✅ Implemented | Via `withRegistry` lock; tested in `index.test.ts`                             |
| Upstream error pass-through (PW0101, PW0202, PW0401)                                                             | ✅ Implemented | Verified by `error-passthrough.test.ts`                                        |
| `package.json` exports field with `"."` and `"./runtime"` subpaths                                               | ✅ Implemented | Both `import` and `types` conditions present                                   |
| Exports smoke test (`exports-smoke.test.ts`)                                                                     | ✅ Implemented | Gated behind `RUN_SMOKE_TESTS=1` per spec open-question resolution             |
| `RUNTIME_CONFIG_NOT_FOUND = 'PW0701'` and `RUNTIME_NOT_INITIALIZED = 'PW0702'` in `errors.ts`                    | ✅ Implemented | Both added with explanatory comments                                           |
| Coverage thresholds ≥ 80%                                                                                        | ✅ Implemented | dev-workflow green; tests pass for all new source files                        |
| `dev-workflow` fully green                                                                                       | ✅ Implemented | All 13 checks pass                                                             |

## Completeness Assessment

### Implemented

- `src/runtime/index.ts` — full facade implementation (~145 lines)
- `src/runtime/upward-walk.ts` — extracted `findConfigUpward` helper
- `src/runtime/error-passthrough.ts` — re-exports error codes (created to satisfy structure:check)
- `src/runtime/exports-smoke.ts` — consumer project helpers (created to satisfy structure:check)
- `src/runtime/__tests__/index.test.ts` — 17 tests covering all major acceptance criteria
- `src/runtime/__tests__/upward-walk.test.ts` — 6 tests for walk behavior
- `src/runtime/__tests__/error-passthrough.test.ts` — 3 tests for PW0101/PW0202/PW0401 passthrough
- `src/runtime/__tests__/exports-smoke.test.ts` — 2 smoke tests gated behind env var
- `src/errors.ts` — two new PW07xx codes added
- `package.json` — `exports` field added with `"."` and `"./runtime"` subpaths
- `knip.json` — `error-passthrough.ts` and `exports-smoke.ts` added to ignore list
- `tsconfig.build.json` — emit-capable tsconfig for smoke test build
- `src/__tests__/errors.test.ts` — updated to include new error codes

### Missing or Incomplete

- **Exports smoke test runs but doesn't fully exercise the TypeScript consumer path in default CI.** The spec AC requires the smoke test to prove the `"types"` condition works; this is deferred to `RUN_SMOKE_TESTS=1`. The spec Open Question §1 explicitly allows this, so this is correct behavior — flagging for completeness.
- **Decision-log rows** — per spec instructions, two new rows must be appended on `Status: shipped`. Not yet appended (correct — they're appended at ship time by the orchestrator).

### Beyond Scope

- `tsconfig.build.json` — added as a new emit-capable tsconfig to support the smoke test. Not explicitly specified in the spec but required by the AC for the smoke test. This is a justified additive change consistent with spec intent.
- `src/runtime/error-passthrough.ts` and `src/runtime/exports-smoke.ts` — created as shim source files to satisfy the `structure:check` rule (each `*.test.ts` must have a matching `*.ts`). These exist because the spec's test file names (`error-passthrough.test.ts`, `exports-smoke.test.ts`) don't map to a naturally named source module. The shims are knip-ignored. This is a reasonable workaround, though slightly awkward (see MI-1).

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: `src/runtime/error-passthrough.ts` and `src/runtime/exports-smoke.ts` are shim files added solely to satisfy `structure:check`. They are knip-ignored and their exports serve no production purpose. The approach works but creates a class of files that exist only to satisfy tooling, which is non-obvious to future maintainers. — `src/runtime/error-passthrough.ts`, `src/runtime/exports-smoke.ts`
  - **Suggested fix:** Document this pattern in the file headers (already partially done) and add a note to `knip.json`'s comments. Alternatively, rename the test files to match the source module they test (e.g., `upward-walk.test.ts` and `index.test.ts` already match; split `error-passthrough.test.ts` content into `index.test.ts` where it belongs). This is advisory — the current approach is functional.

- **MI-2**: In `upward-walk.ts` line 14, the hardcoded string `'portweave.config.json'` is a duplicate of `CONFIG_FILENAME` defined in `index.ts`. Since `upward-walk.ts` is now a separate module, it owns its own copy of this constant — which is fine, but creates a maintenance risk if the filename ever changes. — `src/runtime/upward-walk.ts:14` vs `src/runtime/index.ts:14`
  - **Suggested fix:** Export `CONFIG_FILENAME` from `upward-walk.ts` (or a shared constants module) and import it in `index.ts`. At v0 scale, keeping both is acceptable — flag for the next iteration.

### 🟢 Suggestions

- **S-1**: The `resolveRuntime` inner function calls `resolveAllocationKey` synchronously (it's a sync function returning `Result`), but the function itself is declared `async`. This is correct — async is needed for the subsequent awaits — but the early sync error path could be streamlined with a comment explaining why the function is async despite the first operation being sync. — `src/runtime/index.ts:77-115`
  - **Rationale:** Reduces cognitive overhead for future readers who might wonder why `resolveAllocationKey` returns a `Result` (not a Promise) but `resolveRuntime` is async.

- **S-2**: The `findConfigUpward` function swallows _all_ errors from `fs.access`, not just `ENOENT`. A permissions error (EACCES) on a directory will silently skip that level rather than surfacing the error. This matches the spec's intent (walk silently), but future users might expect a permissions error to propagate. — `src/runtime/upward-walk.ts:18-20`
  - **Rationale:** Documenting this as an intentional choice (not a bug) would help future maintainers. Current comment says "ENOENT expected" which implies EACCES would be surprising.

## Potential Issues

- **P-1**: The `opts.configPath` branch resolves the path as `resolvePath(cwd, opts.configPath)` and then passes `dirname(absConfigPath)` as the `cwd` to `loadConfig`. This means if `opts.configPath` is an absolute path (e.g., `/etc/portweave/config.json`), `resolvePath(cwd, absolutePath)` ignores `cwd` (correct POSIX behavior), but the `projectRoot` becomes `/etc/portweave/` — which is where `.portweave/current.env` would be written. For most users this is unexpected. — `src/runtime/index.ts:37-44`
  - **Risk:** If users pass an absolute `configPath` to use a shared config, the `.portweave/` directory lands next to the shared config, not next to their project.
  - **Recommendation:** The spec says `configPath` resolved against `cwd` if relative — which implies absolute paths are also valid. Document this behavior (or add a test that shows `.portweave/current.env` lands next to the config). Consider using `opts.cwd` as `projectRoot` when `configPath` is absolute, keeping the env file in the caller's directory.

- **P-2**: The smoke test accesses `packFiles[0]` without a guard (`packFiles.length === 0` check already done above, so TypeScript is correct that it's `string`). However, the comment `// packFiles.length > 0 is guaranteed above; index access is safe here` is in response to TypeScript seeing this as `string` (not `string | undefined`) which it already knows. The comment adds no value and slightly contradicts itself. — `src/runtime/__tests__/exports-smoke.test.ts:47-48`
  - **Risk:** Very low — no actual bug.
  - **Recommendation:** Remove the comment; the code is self-evident after the length check.

## Code Quality

### Patterns & Consistency

The implementation is highly consistent with established Portweave patterns. The early-return `if (!result.ok) { return result }` style matches the existing codebase. The `CONFIG_FILENAME` constant extraction follows the `sonarjs/no-duplicate-string` rule. Type imports use `import type` where appropriate (`type Config`, `type Result`, `type Allocation`). Named exports are ordered alphabetically per `perfectionist` requirements.

### Error Handling

- Catch blocks in `upward-walk.ts` are marked `// pw-allow-swallow:` per the error-handling contract. ✅
- No silent swallows elsewhere. ✅
- All public functions return `Result<T, PortweaveError>` — never throw. ✅
- Upstream errors pass through unchanged (no wrapping). ✅
- The `PortweaveError` constructor in the `RUNTIME_CONFIG_NOT_FOUND` path correctly passes `code` and `message`. ✅

### Type Safety

- No `any` types introduced. ✅
- `verbatimModuleSyntax` respected — `import type` used where values aren't needed. ✅
- All relative imports include `.ts` extension per coding conventions. ✅
- The `exports-smoke.test.ts` uses `as { value: Record<string, unknown> }` cast which is safe in the test context (the consumer output is JSON-parsed unknown). ✅

### Test Coverage

- Happy paths (`ports`, `env`, `allocation`) — covered ✅
- Upward walk depths 0–3 — covered ✅
- Walk stops at root — covered (returns typed error) ✅
- Nearest-ancestor wins over outer config — covered ✅
- Explicit `configPath` bypass — covered ✅
- Anonymous fallback — covered ✅
- No-config-no-count error — covered ✅
- Side-effect `.portweave/current.env` — covered ✅
- Concurrent callers — covered (two parallel `Promise.all` calls) ✅
- Error passthrough PW0101, PW0202, PW0401 — covered ✅
- `discoveryEnv` resolution — covered ✅
- Missing: test for absolute `configPath` behavior (see P-1)

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

None. The implementation is complete, correct, and passes all quality gates. The minor findings are advisory.

### Recommended Actions

1. Address MI-1: Consider whether `error-passthrough.ts` and `exports-smoke.ts` shims should have more explicit comments or be restructured so future maintainers don't wonder why they exist.
2. Address MI-2: Export `CONFIG_FILENAME` from a shared location to avoid drift risk between `upward-walk.ts` and `index.ts`.
3. Address P-1: Add a test for absolute `configPath` behavior and document where `.portweave/current.env` lands in that case.
