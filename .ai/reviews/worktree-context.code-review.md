---
title: 'Worktree Context, Namespace Derivation, and Overrides'
source: '.ai/specs/worktree-context/worktree-context.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-24
reviewer: code-review-subagent
---

# Code Review: Worktree Context, Namespace Derivation, and Overrides

## Summary

Reviewed the `worktree-context` feature implementation against `.ai/specs/worktree-context/worktree-context.md`. The implementation is accurate and complete — all spec requirements are implemented, the stickiness contract (DESIGN.md §5.4) is honored, error handling follows Portweave conventions, and tests use real git I/O with no mocking. One minor latent stickiness hazard exists in `deriveNamespace` (hash computed from the raw, possibly un-normalized path argument), and one nit-level redundancy appears in `parseExplicitOffset`. No blocking issues.

## Source

- **Spec:** `.ai/specs/worktree-context/worktree-context.md`
- **Feature doc:** `.ai/features/worktree-context/worktree-context.md`
- **Branch:** `jl/build-specs`
- **Files reviewed:** 9 (3 source, 4 test, `src/errors.ts`, `src/index.ts`)
- **Changes analyzed:** New `src/worktree/` area — git detection, namespace derivation, `AllocationKey` composition; PW0201/PW0202 error codes added; public API re-exported from `src/index.ts`

## Accuracy Assessment

| Requirement                                                                                                                                 | Status         | Notes                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `git.ts` exports `detectGitWorktreeContext`, `gitEnvForCwd`, `parseWorktreeRoots`, `normalizePath`, `GitWorktreeContext`                    | ✅ Implemented | All present with correct shapes                                                                       |
| `detectGitWorktreeContext` on fresh `git init` returns `ok` with absolute fields                                                            | ✅ Implemented | Tested with `createTempGitRepo()`                                                                     |
| `detectGitWorktreeContext` on non-git dir returns `err(NOT_A_GIT_REPO)`                                                                     | ✅ Implemented | Covered in `git.test.ts`                                                                              |
| `detectGitWorktreeContext` from inside `git worktree add`'d tree returns feature root as `currentRoot`                                      | ✅ Implemented | Covered with `addGitWorktree` helper                                                                  |
| `gitEnvForCwd` strips `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX`                                                            | ✅ Implemented | Two tests: stripping and no-mutation-of-process.env                                                   |
| `namespace.ts` exports `MAIN_NAMESPACE`, `deriveNamespace`, `sanitizeNamespace`, `namespaceOverride`, `parseExplicitOffset`                 | ✅ Implemented | All present                                                                                           |
| `deriveNamespace(root, root)` → `'main'`; feature root returns slug-hash form                                                               | ✅ Implemented | Determinism test present                                                                              |
| `sanitizeNamespace` truncates at 40, collapses non-slug chars, strips surrounding dashes, falls back to `MAIN_NAMESPACE`                    | ✅ Implemented | Full edge-case coverage in tests                                                                      |
| `namespaceOverride` sanitizes `'Foo Bar!'` → `'foo-bar'`; returns `null` for unset/whitespace                                               | ✅ Implemented | `vi.stubEnv` used correctly                                                                           |
| `parseExplicitOffset` returns `ok(null)` unset; `ok(N)` for non-negative integer (no 99-cap); `err(WORKTREE_OFFSET_INVALID)` for bad values | ✅ Implemented | `1e3`, `0x10`, `abc`, `-1`, `7.5` all rejected                                                        |
| `key.ts` exports `resolveAllocationKey`, `AllocationKey` with correct field shape                                                           | ✅ Implemented | Shape matches spec exactly                                                                            |
| `resolveAllocationKey` non-git fallback: `gitCommonDir === null`, `worktreeRoot === path.resolve(cwd)`, `namespace === 'main'`              | ✅ Implemented | Covered in `key.test.ts`                                                                              |
| Stickiness contract: two calls same path → deeply equal `AllocationKey`                                                                     | ✅ Implemented | `toStrictEqual` assertion                                                                             |
| Distinctness contract: main vs feature worktree → non-equal `AllocationKey`                                                                 | ✅ Implemented | Both `worktreeRoot` and `namespace` compared                                                          |
| `PORTWEAVE_NAMESPACE` override applied; `PORTWEAVE_OFFSET=12` populates `offsetOverride`; bad offset → `err`                                | ✅ Implemented | Three dedicated tests in `key.test.ts`                                                                |
| `src/errors.ts` gains `NOT_A_GIT_REPO: 'PW0201'` and `WORKTREE_OFFSET_INVALID: 'PW0202'`; seed codes unchanged                              | ✅ Implemented | `errors.test.ts` asserts the exact full shape                                                         |
| `src/index.ts` re-exports all 9 specified symbols                                                                                           | ✅ Implemented | All 9 present; no extras                                                                              |
| Tests under `src/worktree/__tests__/`, one per source file, real I/O, cleanup via `rmSync`                                                  | ✅ Implemented | No `vi.mock('fs')` or `vi.mock('child_process')`                                                      |
| Catch blocks narrow `unknown`; no silent swallows                                                                                           | ✅ Implemented | `_helpers.ts` throws typed `Error`; no catch blocks in source files (errors surface via return value) |

## Completeness Assessment

### Implemented

- `src/worktree/git.ts` — full implementation with `resolveGitPath` correctly kept private (not required by spec)
- `src/worktree/namespace.ts` — full implementation with compiled regex constants
- `src/worktree/key.ts` — full implementation of the algorithm from spec §key.ts
- `src/worktree/__tests__/git.test.ts` — all spec-required test scenarios plus two useful extras (empty-input guard for `parseWorktreeRoots`, no-mutation-of-process.env)
- `src/worktree/__tests__/namespace.test.ts` — all spec test cases; `it.each` table covers `1e3` and `0x10` beyond the spec's minimum examples
- `src/worktree/__tests__/key.test.ts` — all spec test cases
- `src/worktree/__tests__/_helpers.ts` — `createTempGitRepo`, `addGitWorktree`, `createTempDir`; uses `realpathSync` to resolve macOS `/tmp` → `/private/tmp` symlink (load-bearing for stickiness on macOS)
- `src/errors.ts` — PW0201 and PW0202 added; seed codes unchanged; test updated with exact shape assertion
- `src/index.ts` — all 9 specified exports present

### Missing or Incomplete

None — all spec requirements are implemented.

### Beyond Scope

- `src/worktree/__tests__/git.test.ts`: Two extra test cases added beyond the spec minimum — `parseWorktreeRoots` against empty string, and `gitEnvForCwd` no-mutation-of-process.env assertion. Both are harmless, low-cost, and strengthen the suite.
- `src/worktree/__tests__/namespace.test.ts`: `it.each` table includes `'1e3'` and `'0x10'` invalid-offset cases not listed in the spec. Same judgment: harmless additions.
- `src/worktree/__tests__/namespace.test.ts` line 49-52: Extra `deriveNamespace` normalization test (`/tmp/foo/` and `/tmp/foo/./.` both → `MAIN_NAMESPACE`). Not in spec, but directly validates the normalization behavior.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: `deriveNamespace` hashes the raw (un-normalized) `currentRoot` argument — `src/worktree/namespace.ts:25`
  - The equality short-circuit on line 20 correctly normalizes both sides (`normalizePath(currentRoot) === normalizePath(mainRoot)`), but line 25 calls `hashPath(currentRoot)` with the original value. If a caller passes a path with trailing slashes or `.` segments, the hash will differ from a normalized call, producing a different namespace for the same physical path.
  - **Suggested fix:** Normalize before hashing — `const normalized = normalizePath(currentRoot)` at the top of the function and use `normalized` in both the equality check and the `hashPath` call. This matches the stickiness guarantee and mirrors how `resolveAllocationKey` already normalizes before calling `deriveNamespace`.
  - **Note:** In practice this is not triggered today — `resolveAllocationKey` always passes already-normalized paths (from `detectGitWorktreeContext` or `resolve(cwd)`). The hazard is latent at the public API surface.

### 🟢 Suggestions

- **S-1**: The second guard in `parseExplicitOffset` (`!Number.isSafeInteger(offset) || offset < 0`) is unreachable given the preceding `OFFSET_LITERAL` regex — `src/worktree/namespace.ts:52`
  - The `OFFSET_LITERAL = /^\d+$/` regex already guarantees the trimmed value is a non-negative decimal integer string, so `parseInt` returns a non-negative integer. `Number.isSafeInteger` can only fail for astronomically large values (> 2^53-1 digit strings), which the regex would still accept. The extra guard is harmless defensive programming but adds noise.
  - **Rationale:** Either document the intent with a comment (`// guard against >Number.MAX_SAFE_INTEGER digit strings`) or remove the `offset < 0` branch since it's provably unreachable. Keeping it undocumented leaves a future reader wondering why the branch exists.

## Potential Issues

- **P-1**: `deriveNamespace` public API accepts unnormalized paths and produces different hashes for semantically equivalent paths — `src/worktree/namespace.ts:19-26`
  - **Risk:** A future caller (e.g. a CLI flag handler, a test utility) passes a path with a trailing slash or `..` component. The derived namespace differs from what `resolveAllocationKey` would produce, causing a registry miss and a spurious new allocation.
  - **Recommendation:** Apply MI-1's fix to normalize `currentRoot` before hashing. Alternatively, add a note in the function's doc comment that callers must pass normalized paths — but a fix is preferable over documentation-only mitigation.

- **P-2**: `_helpers.ts:createTempGitRepo` commits with `--allow-empty` but the branch is `main` — if the test machine has `init.defaultBranch` set to something other than `main`, the `--initial-branch=main` flag handles it. However, `git worktree add` in `addGitWorktree` creates a new branch derived from the commit; if `git` is not installed or is very old (pre-2.15), `--initial-branch` may not be recognized — `src/worktree/__tests__/_helpers.ts:13`
  - **Risk:** CI environments with old git versions (< 2.28 for `--initial-branch`) will throw from the helper's `runGit` call, causing all worktree tests to fail with an opaque error.
  - **Recommendation:** Add a comment on the minimum git version requirement, or add a `beforeAll` suite-level check that gates the test suite on `git --version`. This is low priority given Node 24+ already implies a modern development machine.

## Code Quality

### Patterns & Consistency

The implementation follows Portweave conventions throughout. Naming is consistent (`detectGitWorktreeContext`, `resolveAllocationKey` — verb-noun, camelCase). Constants are extracted at the module top level (`HASH_LENGTH`, `MAX_SLUG_LENGTH`, `DECIMAL_RADIX`, `NAMESPACE_ENV`, `OFFSET_ENV`). Compiled regex constants (`NON_SLUG_CHARS`, `SURROUNDING_DASHES`, `OFFSET_LITERAL`) are defined at module scope rather than inline in functions — a quality improvement over some of Gameweave's prior worktree-port code.

The three-file decomposition (`git.ts` / `namespace.ts` / `key.ts`) matches the spec's stated structure and keeps each file clearly scoped to one responsibility.

### Error Handling

`Result<T, E>` is used correctly throughout — all expected failure modes surface as `Result` values, not throws. `key.ts` correctly propagates unexpected git errors (non-`NOT_A_GIT_REPO` cases) without swallowing. The helper `_helpers.ts:runGit` throws for setup-time failures (appropriate — test infrastructure failures should abort the suite). No silent swallows anywhere. `PortweaveError` in `errors.ts` includes `Object.setPrototypeOf` (verified).

### Type Safety

No `any` types. All relative imports include `.ts` extensions (`'../errors.ts'`, `'./git.ts'`). `import type` is used for `Result` where only the type is needed (`import { err, ok, type Result }`). `verbatimModuleSyntax` is respected. The `as const satisfies Record<string, \`PW${number}\`>`annotation on`PW_ERROR_CODES` is a clean constraint that will catch typos at compile time.

### Test Coverage

All spec-required scenarios are covered. Tests use `realpathSync` to resolve macOS symlinks — a subtle but load-bearing choice for stickiness on macOS where `os.tmpdir()` returns `/tmp` (symlink to `/private/tmp`). Cleanup is handled via `afterEach` in all test files. `vi.stubEnv` / `vi.unstubAllEnvs` are used correctly for env-var tests, restoring state between cases. No filesystem mocking (`vi.mock('fs')`) — correct per `.claude/rules/testing.md`.

The stickiness and distinctness contract tests in `key.test.ts` are the most important tests in this feature and both are present and correctly implemented.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 1     |
| 🟢 Suggestions      | 1     |
| ⚠️ Potential Issues | 2     |

### Required Actions

None — no blocking issues.

### Recommended Actions

1. Address MI-1 / P-1: Normalize `currentRoot` before calling `hashPath` in `deriveNamespace` (`src/worktree/namespace.ts:25`) to close the latent stickiness gap at the public API surface.
2. Address S-1: Document or remove the unreachable `offset < 0` branch in `parseExplicitOffset` (`src/worktree/namespace.ts:52`).
