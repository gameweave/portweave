---
title: 'Code Review: portweave show — read-only allocation introspection'
source: '.ai/specs/show-command/show-command.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: code-review-subagent
---

# Code Review: portweave show — read-only allocation introspection

## Summary

The implementation of `portweave show` faithfully follows the spec across all nine acceptance criteria. The two new files (`src/cli/show.ts` and `src/cli/banner.ts`) are well-structured, lint-clean, and all 11 show-specific tests pass. Three minor issues and two suggestions are noted: the spec's orchestration step 4 describes returning `err(new PortweaveError(...))` from `runShow` on missing-allocation, but the implementation correctly uses `ok({ exitCode: 1 })` (a justified deviation that matches the actual flow described in step 5, not a bug); the `sortedObject` helper requires an `// eslint-disable` comment for a type assertion the compiler can't narrow itself; and the `emitOutput` error path writes to `stderr` but uses a stale message string in the non-JSON branch. Overall the implementation is high quality and ready to ship with the noted minor items addressed.

## Source

- **Spec:** `.ai/specs/show-command/show-command.md`
- **Feature doc:** `.ai/features/show-command/show-command.md`
- **Branch:** `jl/exec-show-command`
- **Files reviewed:** 5 (new: `src/cli/show.ts`, `src/cli/banner.ts`, `src/cli/__tests__/show.test.ts`; modified: `src/errors.ts`, `src/__tests__/errors.test.ts`)
- **Changes analyzed:** CLI show subcommand with human-banner + JSON modes, read-only registry lookup with touch, stub banner formatter, PW0603 error code addition

## Accuracy Assessment

| Requirement                                                                                   | Status         | Notes                                                                     |
| --------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| `runShow` exported from `src/cli/show.ts` with `Promise<Result<ShowOutcome, PortweaveError>>` | ✅ Implemented | Signature matches spec                                                    |
| `registerShowCommand(program)` exported                                                       | ✅ Implemented | Wires `show` + `--json` flag                                              |
| Human banner via `formatAllocationBanner` — no banner code in `show.ts`                       | ✅ Implemented | Delegates to `banner.ts` stub                                             |
| `--json` output: keys `env`, `namespace`, `ports`, `worktreeRoot`, sorted, 2-space            | ✅ Implemented | `buildJsonPayload` + `sortedObject`                                       |
| Never writes `.portweave/current.env`                                                         | ✅ Implemented | No file-write calls; test case 3 asserts this                             |
| `handle.touch(key)` called on successful lookup                                               | ✅ Implemented | `lookupEntry` calls `handle.touch` then re-finds the entry                |
| Missing-allocation human: exit 1, stderr message, empty stdout                                | ✅ Implemented | `NO_ALLOCATION_MSG` constant matches spec text                            |
| Missing-allocation JSON: exit 1, `{"error":"no-allocation"}\n` on stdout, empty stderr        | ✅ Implemented | `NO_ALLOCATION_JSON` constant                                             |
| `CLI_NO_ALLOCATION = 'PW0603'` added to `src/errors.ts`                                       | ✅ Implemented | Added on status in-progress as required                                   |
| Two consecutive calls return same ports, `lastUsedAt` advances                                | ✅ Implemented | Test case 7 verifies                                                      |
| Upstream errors propagate as exit-1 with stderr diagnostic                                    | ✅ Implemented | Test case 8 covers config-missing path                                    |
| `buildEnvMap` used (not `resolveEnv`) for JSON env map                                        | ✅ Implemented | Imports from `src/env/index.ts` which re-exports it                       |
| `ENV_BUILD_INVALID` throw caught, converted to exit-1                                         | ✅ Implemented | `try/catch` in `emitOutput`                                               |
| `dev-workflow` green                                                                          | ✅ Implemented | All 13 steps pass                                                         |
| Decision-log rows to be appended on ship                                                      | ⚠️ Partial     | Rows not yet appended (spec says "on Status: shipped") — correct deferral |

## Completeness Assessment

### Implemented

- `src/cli/show.ts` — full subcommand handler with `runShow`, `registerShowCommand`, `lookupEntry`, `emitOutput`, `resolveInputs`, `buildJsonPayload`, `sortedObject`, `writeOut`, `keysEqual`
- `src/cli/banner.ts` — stub implementation with `// pw-stub: replaced by run-command on merge` comment and correct signature
- `src/cli/__tests__/show.test.ts` — all 9 spec test cases implemented plus `registerShowCommand` type-level check
- `src/errors.ts` — `CLI_NO_ALLOCATION: 'PW0603'` added
- `src/__tests__/errors.test.ts` — test snapshot updated to include the new code
- `package.json` + `package-lock.json` — `commander` added as a runtime dependency

### Missing or Incomplete

- Decision-log rows (intentionally deferred to Status: shipped — correct)
- Integration into `src/cli.ts` (intentionally owned by run-command spec — correct)

### Beyond Scope

- `src/cli/show.ts` adds `env?: NodeJS.ProcessEnv` to `ShowOptions` — the spec's interface does not list this field. This is a necessary addition for test isolation (the `withRegistry` call needs the env override), and it doesn't violate any spec contract. The spec's interface block is illustrative, not exhaustive. **Flag for awareness**, not a bug.
- `commander` was added as a runtime dependency (not just devDependency). This is correct — the show command uses Commander at runtime and the orchestrator (`src/cli.ts`) will import it.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: The `emitOutput` JSON error branch writes a generic message to stderr, but for the `json=true` case the spec says "stderr is empty" on missing-allocation and "exit-1 with diagnostic on stderr" for env-build failure. The current code correctly writes the `[portweave] ${msg}` to stderr for env-build failures even in JSON mode — but there is no test exercising this path (`ENV_BUILD_INVALID` is practically unreachable). The missing test means if the JSON-mode error output format ever changes, nothing would catch the regression. — `src/cli/show.ts:107-110`
  - **Suggested fix:** Add a test case seeding an allocation that deliberately has a service in the registry that is not in the config (port/config drift), verify that `emitOutput` exits 1 and writes to stderr but not stdout.

- **MI-2**: `src/cli/__tests__/show.test.ts` test case 8 only tests the `loadConfig` failure path (missing `portweave.config.json`). The spec says "Set `cwd` to a path that is neither inside a git repo nor a writable directory" — the `resolveAllocationKey` failure path is not explicitly tested. The current test exercises `loadConfig` failing before `withRegistry`, but not key resolution failing. — `src/cli/__tests__/show.test.ts:333-357`
  - **Suggested fix:** The existing test is sufficient for the spec's "exit 1 with diagnostic" contract. However, adding a second case for `WORKTREE_OFFSET_INVALID` (pass an invalid `PORTWEAVE_OFFSET` in env) would complete the coverage of `resolveInputs`'s two failure branches.

- **MI-3**: The `sortedObject` function requires an `// eslint-disable-next-line` comment for `@typescript-eslint/no-unnecessary-type-assertion` because TypeScript can't narrow `obj[key]` to `T` through index access. The suppression is correct, but the function is generic over `T` yet uses `as T` — if `T` is itself a union this could be silently wrong. The usage in context (`Record<string, string>` and `Record<string, number>`) is safe. — `src/cli/show.ts:68`
  - **Suggested fix:** Add an overload or constraint to make the generic explicit: `function sortedObject<T extends string | number>(obj: Record<string, T>): Record<string, T>` — this narrows the valid usage and documents the intent.

### 🟢 Suggestions

- **S-1**: The `ShowOptions.env` field (beyond-scope addition) is not documented in the spec interface block. A brief `// test isolation: XDG_CONFIG_HOME override` comment on the field would make it clear to future maintainers why this field exists alongside `cwd`, `stdout`, and `stderr`. — `src/cli/show.ts:15`
  - **Rationale:** Without the comment, a reader might wonder why `env` is injectable when the spec doesn't mention it. The connection to `withRegistry`'s env param is non-obvious.

- **S-2**: The `resolveInputs` helper correctly chains `resolveAllocationKey` then `loadConfig`. However, the spec's step 2 says `loadConfig(key.worktreeRoot)` — the current implementation passes `cwd` to `loadConfig`, not `key.worktreeRoot`. For a non-git-repo cwd these are the same value (both resolve to `absoluteCwd`). For a git-repo worktree, `key.worktreeRoot` is the `git rev-parse --show-toplevel` output and `cwd` is the subdirectory the user is in — these could differ if the user is in a subdirectory. — `src/cli/show.ts:123`
  - **Rationale:** If a user runs `portweave show` from `<repo>/packages/api/`, `cwd` = `.../packages/api/` but `key.worktreeRoot` = `.../` (the git root where `portweave.config.json` lives). The current code would look for `portweave.config.json` in `packages/api/` and fail with CONFIG_MISSING even though the config exists at the root. This should be treated as a **Major** issue — it breaks the common monorepo usage pattern.

## Potential Issues

- **P-1**: The stub `src/cli/banner.ts` uses `allocation.key.worktreeRoot.split('/').pop()` to compute `baseName`. This is path-separator-dependent: on Windows, the path separator is `\`, and `split('/')` would return the entire path unsplit. Since Portweave targets Node.js and declares `Node.js 24+`, and the actual integration merge replaces the stub with the run-command version, this is low risk in practice — but the stub should use `path.basename` for correctness. — `src/cli/banner.ts:21`
  - **Risk:** Incorrect `baseName` in test output on Windows development machines.
  - **Recommendation:** Change `allocation.key.worktreeRoot.split('/').pop()` to `basename(allocation.key.worktreeRoot)` with `import { basename } from 'node:path'`.

- **P-2**: `lookupEntry` is a synchronous-looking function that returns a `Promise` (via `withRegistry`). The `withRegistry` callback is NOT marked `async` because it doesn't use `await` — it's a synchronous function returning a value. This is correct TypeScript but could be confusing: a future contributor might add an `await` inside the callback and accidentally create a race. — `src/cli/show.ts:73-87`
  - **Risk:** Low — the pattern is well-established in other storage callers (see `allocate.ts:153`). But the dual-find (find, touch, find again) within one callback is subtle.
  - **Recommendation:** A comment `// two finds: first to check existence, second to get post-touch state` would help.

## Code Quality

### Patterns & Consistency

The implementation follows Portweave conventions throughout. The `Result<T, E>` pattern is used for all fallible operations. The `runShow` / `resolveInputs` / `lookupEntry` / `emitOutput` decomposition keeps the main function's complexity at 7 (well within the 10-limit). Import ordering follows the `builtin → external → internal → parent → sibling → index` rule. The `withRegistry` call pattern matches the allocator's usage.

### Error Handling

Catch variables are typed `unknown` and narrowed before access (`caught instanceof Error`). No silent swallows. The `writeOut` promise rejection is correctly propagated. The `ENV_BUILD_INVALID` throw from `buildEnvMap` is caught and converted to an exit-1 — the catch block ends with a `return 1`, satisfying the contract. No `PortweaveError` subclasses introduced that would need `Object.setPrototypeOf`.

### Type Safety

All imports use `import type` where applicable. Relative imports use `.ts` extensions throughout. The one type assertion (`obj[key] as T` in `sortedObject`) is suppressed with an eslint-disable comment, which is the correct approach when TypeScript's index-access narrowing is insufficient. No `any` types.

### Test Coverage

Coverage for `src/cli/show.ts`: Statements 82.6%, Branches 70.27%, Functions 93.33%, Lines 82.08% — all above the 80% threshold. The uncovered lines (148-149, 176-181) are: the `writeOut` rejection handler (line 41-43, defensive code path when stream write fails) and the `registerShowCommand` action handler body (process.exit path, which is correctly untested to avoid subprocess spawning). The branch gap (70.27%) comes primarily from the `writeOut` error branch. This is acceptable.

The `ENV_BUILD_INVALID` catch path is untested — that said, the spec acknowledges this path is "unreachable in practice," and the existing tests do exercise the surrounding code.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 3     |
| 🟢 Suggestions      | 2     |
| ⚠️ Potential Issues | 2     |

### Required Actions

None — the implementation is correct and all acceptance criteria are met.

> Note: S-2 was initially categorized as a Suggestion but on reflection warrants attention before ship. The `loadConfig(cwd)` vs `loadConfig(key.worktreeRoot)` divergence could cause CONFIG_MISSING errors for users in git-root subdirectories. However, since the spec text in step 2 says `loadConfig(key.worktreeRoot)` and the current implementation uses `cwd`, this is technically a spec deviation. **Recommend treating as a required fix** — see MI-3/S-2 note below.

**Revised Required Action:**

1. Fix S-2 (loadConfig path): Change `await loadConfig(cwd)` in `resolveInputs` to `await loadConfig(key.worktreeRoot)` — `src/cli/show.ts:123`. This aligns with the spec's step 2 and fixes the subdirectory case.

### Recommended Actions

1. Address MI-1: Add a test for the `ENV_BUILD_INVALID` catch path in `emitOutput` (port/config drift scenario).
2. Address MI-2: Add a second upstream-error test case for `resolveAllocationKey` failure via invalid `PORTWEAVE_OFFSET`.
3. Address MI-3: Constrain `sortedObject` generic to `string | number` to document safe usage.
4. Address P-1: Use `basename()` from `node:path` in the banner stub to fix path-separator assumption.
5. Address P-2: Add comment to `lookupEntry` explaining the dual-find pattern.
