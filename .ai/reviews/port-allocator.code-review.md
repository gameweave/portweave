---
title: 'Port Allocator and Live Conflict Probe — Code Review'
source: '.ai/specs/port-allocator/port-allocator.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-25
reviewer: code-review-subagent
---

# Code Review: Port Allocator and Live Conflict Probe

## Summary

The port-allocator implementation matches the spec faithfully. All 16 acceptance criteria are implemented, all 204 tests pass, and the full `dev-workflow` quality suite is green. The implementation correctly separates concerns into `pool.ts` (pure block search), `probe.ts` (TCP live probe), and `allocate.ts` (orchestrator with registry integration). Two minor issues are flagged: one structural concern about documentation-only stub source files that knip must ignore, and one edge-case gap in `resolvePoolRange` where a value like `30000-0` (non-positive end) is silently accepted rather than rejected. Neither blocks ship.

## Source

- **Spec:** `.ai/specs/port-allocator/port-allocator.md`
- **Feature doc:** `.ai/features/port-allocator/port-allocator.md`
- **Branch:** `jl/v0-layer-2`
- **Files reviewed:** 18 (7 source, 11 test/fixture/helper)
- **Changes analyzed:** New `src/allocator/` subtree: `pool.ts`, `probe.ts`, `allocate.ts`, `allocate.concurrent.ts`, `cross-project.ts`, `order.ts`; shared test helpers `src/__tests__/_concurrent-helpers.ts`, `src/allocator/__tests__/_helpers.ts`; fixture `src/allocator/__tests__/fixtures/concurrent-allocator.ts`; test files for pool, probe, order, allocate, cross-project, concurrent; updated `src/index.ts`, `knip.json`.

## Accuracy Assessment

| Requirement                                                                                                             | Status         | Notes                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `allocate(key, config, env?)` exported from `allocate.ts` returning `Promise<Result<AllocationResult, PortweaveError>>` | ✅ Implemented | Matches spec signature exactly                                                                                                 |
| `Allocation = RegistryEntry` type alias exported                                                                        | ✅ Implemented | Also re-exported through `src/index.ts`                                                                                        |
| `AllocationResult = { allocation: Allocation; reused: boolean }`                                                        | ✅ Implemented | Both fields `readonly` per convention                                                                                          |
| `findFreeBlock(occupiedSorted, slotCount, range) → number \| null` pure, ascending                                      | ✅ Implemented | Pure; ascending from `range.start`; uses efficient `oi` pointer                                                                |
| Pool range `[30000, 60000)` default, `PORTWEAVE_POOL_RANGE` override                                                    | ✅ Implemented | Constants exported; malformed values fall back silently                                                                        |
| Malformed/inverted/non-integer values fall back silently                                                                | ✅ Implemented | 9 fallback test cases in `pool.test.ts`                                                                                        |
| `probePort(port) → Promise<'free' \| 'taken'>` binds to `127.0.0.1`                                                     | ✅ Implemented | Single error handler merges EADDRINUSE + other errors → 'taken'                                                                |
| `probeBlock(start, count)` short-circuits on first taken port                                                           | ✅ Implemented | Sequential probe, returns `firstTakenPort`                                                                                     |
| `orderServicesForAllocation` produces contiguous groups in first-occurrence order                                       | ✅ Implemented | Algorithm matches spec pseudocode exactly                                                                                      |
| Stickiness: same key → same ports + `reused: true`                                                                      | ✅ Implemented | `tryReuseExisting` probes all ports before returning reuse                                                                     |
| Live-conflict reuse invalidation: external binding on any port → remove + reallocate                                    | ✅ Implemented | Calls `handle.remove(key)` then falls to fresh allocation                                                                      |
| Fresh-allocation skip-on-probe-fail: advances past externally-taken ports                                               | ✅ Implemented | `externallyOccupied` accumulates; `findFreeBlock` skips them                                                                   |
| Pool exhaustion → `err(PW0401)` with two distinct messages                                                              | ✅ Implemented | Registry-saturated vs. externally-saturated messages differ                                                                    |
| `MAX_PROBE_RETRIES = 100` caps retry loop                                                                               | ✅ Implemented | Exported constant; test asserts the value                                                                                      |
| Allocation inside `withRegistry` (locking, pruning, atomic save)                                                        | ✅ Implemented | Entire flow within single `withRegistry` call                                                                                  |
| `offsetOverride` preserved in stored entry, not used for search                                                         | ✅ Implemented | Passed through in `RegistryEntry`; no search influence                                                                         |
| Cross-worktree concurrent correctness (4 subprocesses, no overlap)                                                      | ✅ Implemented | Real `child_process.fork` with real `net` — no mocks                                                                           |
| Cross-project collision protection (distinct `gitCommonDir`)                                                            | ✅ Implemented | `cross-project.test.ts` verifies non-overlapping sets                                                                          |
| Coverage ≥ 80% across statements/branches/functions/lines                                                               | ✅ Implemented | 96.98% stmts, 91.57% branches, 100% funcs, 96.89% lines                                                                        |
| `dev-workflow` green                                                                                                    | ✅ Implemented | All 13 steps pass                                                                                                              |
| Decision-log rows (3) appended on Status: shipped                                                                       | ⚠️ Partial     | Decision-log rows are spec-required on `Status: shipped`, not yet written (correct behavior — implementation is `in-progress`) |

## Completeness Assessment

### Implemented

- `src/allocator/pool.ts` — `POOL_START_DEFAULT`, `POOL_END_DEFAULT`, `PoolRange`, `resolvePoolRange`, `findFreeBlock`
- `src/allocator/probe.ts` — `probePort`, `ProbeBlockResult`, `probeBlock`
- `src/allocator/allocate.ts` — `Allocation`, `AllocationResult`, `MAX_PROBE_RETRIES`, `orderServicesForAllocation`, `allocate`
- `src/allocator/allocate.concurrent.ts` — `CONCURRENT_ALLOCATOR_PATH`, `CONCURRENT_ALLOCATOR_COUNT`
- `src/allocator/cross-project.ts` — stub file for structure:check compliance
- `src/allocator/order.ts` — stub file for structure:check compliance
- `src/__tests__/_concurrent-helpers.ts` — `TSX_PATH`, `ConcurrentTestDirs`, `makeConcurrentDirs`, `cleanupConcurrentDirs`
- `src/allocator/__tests__/_helpers.ts` — `ServiceInput`, `makeAllocatorConfig`, `makeAllocationKey`, `bindServerOnPort`, `TempDirs`, `makeTempDirs`, `cleanupTempDirs`, `addWorktreeDir`
- `src/allocator/__tests__/fixtures/concurrent-allocator.ts` — fork worker for concurrent test
- All 6 test files: `pool.test.ts`, `probe.test.ts`, `allocate.test.ts`, `order.test.ts`, `cross-project.test.ts`, `allocate.concurrent.test.ts`
- `src/index.ts` — allocator exports added
- `knip.json` — stub files added to ignore list
- Existing `src/registry/__tests__/storage.concurrent.test.ts` refactored to use shared helpers (beyond scope but harmless)

### Missing or Incomplete

- Decision-log rows are correctly pending `Status: shipped` — not missing, intentionally deferred.

### Beyond Scope

- `src/__tests__/_concurrent-helpers.ts` — A new shared helper in the root `src/__tests__/` directory, extracted from the concurrent test pattern. Not mentioned in the spec but reduces duplication between `allocate.concurrent.test.ts` and `storage.concurrent.test.ts`. Net positive.
- `src/registry/__tests__/storage.concurrent.test.ts` — Refactored to use the new shared helpers. Not spec-required but reduces duplication; no behavior change.
- `src/allocator/allocate.concurrent.ts` — The spec describes a concurrent fixture but doesn't specify a sibling source module. The module is required by `structure:check`. Correct approach.
- `src/allocator/cross-project.ts` and `src/allocator/order.ts` — Stub files added to satisfy `structure:check`. Required and minimal.
- `knip.json` — Two stub files added to ignore list since they have no exports. Required.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: `resolvePoolRange` accepts `end <= 0` without fallback — `src/allocator/pool.ts:25-30`

  The validation checks `start > 0` and `end > start`, which means `start=1, end=2` would be accepted (port 1 is a privileged port). A value like `PORTWEAVE_POOL_RANGE=1-2` would silently produce a usable (but dangerous) pool range. The spec says "non-positive" values fall back to the default; it does not specify that values below 1024 (or any privileged threshold) should be rejected, but it's a potential operational foot-gun.
  - **Suggested fix:** Add `end >= 1024` (or at minimum `end > 0`) as a validation condition. Given the spec's "non-positive falls back" wording, this is optional but defensive.

- **MI-2**: `cross-project.ts` and `order.ts` added to `knip.json` ignore list without a comment explaining why — `knip.json:8-9`

  Reviewers arriving at `knip.json` may not understand why these two files are ignored. They are stub source files required to satisfy `structure:check` but containing no exports.
  - **Suggested fix:** Add a JSON comment or an adjacent `_knip-notes.md` explaining the pattern — though JSON doesn't support comments, a convention entry in `.ai/decision-log.md` or a short note in the stub file headers would suffice. The stub files already have comments explaining their purpose, so this is very low priority.

### 🟢 Suggestions

- **S-1**: `resolvePoolRange` could warn/log on malformed input rather than silently falling back — `src/allocator/pool.ts:16-36`

  Silent fallback is spec-correct behavior (same precedent as `PORTWEAVE_LOCK_TIMEOUT_MS`), but a user who typos `PORTWEAVE_POOL_RANGE` will get no indication that their override was ignored. A `process.stderr.write` warning would be easy and helpful.
  - **Rationale:** Matches the precedent set by `resolvePoolRange` spec note and decision-log #19 (env-var-only, no CLI flag, non-positive falls back). A warning is optional but would aid debugging.

- **S-2**: The internal `closeServer` function in `_helpers.ts` is unexported but reachable only through `bindServerOnPort` — `src/allocator/__tests__/_helpers.ts:40`

  This is correct (knip was satisfied by removing the `export`). No action required; just noting that the final state is intentional.

## Potential Issues

- **P-1**: `resolvePoolRange` splits on `-` character, which means a range like `30000-50000` is unambiguous but a hypothetical future format change (e.g., `30000:50000`) would require a breaking env-var change. — `src/allocator/pool.ts:21`
  - **Risk:** If the format specification ever changes, existing user `.env` files or CI configs using `PORTWEAVE_POOL_RANGE=30000-60000` would silently fall back to default (since the new separator wouldn't produce 2 parts after splitting on `-`). This is a protocol concern, not a bug today.
  - **Recommendation:** Document the format in the decision-log (the three ship-time rows cover the pool range default but not the format). Low priority at v0.

- **P-2**: The `orderServicesForAllocation` similarity tool flagged high similarity between `orderServicesForAllocation`, `resolvePoolRange`, and `serializeRegistry` (all ~90% similar). This is a structural artifact of small functions with similar loop patterns, not actual duplicated logic. — `src/allocator/allocate.ts:28-49`, `src/allocator/pool.ts:16-36`
  - **Risk:** None immediate. If future maintainers add logic to these functions, similarity will drop.
  - **Recommendation:** No action required; the similarity score is a false positive from function shape.

- **P-3**: The concurrent allocator fixture at `src/allocator/__tests__/fixtures/concurrent-allocator.ts` uses `process.exit(0/1/2/3)` for exit codes. There is no guarantee that the codes are stable across future changes to the fixture. — `src/allocator/__tests__/fixtures/concurrent-allocator.ts:43-46`
  - **Risk:** The test parent only checks `code === 0` (success path), so the distinction between exit code 1/2/3 is informational only. If a future change adds a new exit code, the test still passes correctly.
  - **Recommendation:** No action required at v0.

## Code Quality

### Patterns & Consistency

The implementation consistently follows Portweave conventions throughout. `Result<T, E>` is used for all fallible business logic (allocate returns `Result`, pool exhaustion returns `err(PW0401)`). The three-layer separation (pure `pool.ts` → I/O `probe.ts` → orchestrator `allocate.ts`) is clean and matches the spec architecture. Naming is consistent with the registry layer (`handle.upsert`, `handle.touch`, `handle.remove`). The `tryReuseExisting` and `allocateFreshBlock` helper functions were correctly extracted to keep `allocate.ts` under the complexity limits.

### Error Handling

All catch blocks are correctly structured. The fixture's `main().catch()` narrows the caught value with `instanceof Error` before reading `.message`. The `probePort` error handler correctly merges all error conditions into a single `resolve('taken')` call (no silent swallow, no path that could hang). The `// pw-allow-swallow: stdout wasn't valid JSON` comment in the concurrent test is properly justified. No unguarded `result.ok` accesses found.

### Type Safety

`import type` is used throughout where appropriate. No `any` types introduced. All relative imports include `.ts` extensions. The `allocate.ts` double-Result unwrap (`outer.value` after checking `outer.ok`) is type-correct — the inner callback returns `Result<AllocationResult, PortweaveError>` directly, and the outer `withRegistry` wraps it in another `Result`. The unwrap at line 163-166 is correct.

### Test Coverage

All acceptance criteria have corresponding tests. The concurrent test uses real `child_process.fork`, real `net.Server` binds, and real filesystem I/O — no mocks. The `probeBlock` short-circuit tests cover first/middle/last positions within the block. The `orderServicesForAllocation` tests cover the idempotent property and complex scattered-group scenarios. Coverage is 96.98% statements, 91.57% branches, 100% functions — well above the 80% threshold. The two uncovered lines (`allocate.ts:164`, `pool.ts:68`) are both defensive branches in loop logic that are unreachable under normal test conditions.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 2     |
| 🟢 Suggestions      | 2     |
| ⚠️ Potential Issues | 3     |

### Required Actions

None — both minor findings (MI-1, MI-2) are non-blocking. The implementation is correct and complete per spec.

### Recommended Actions

1. Address MI-1: consider adding `start >= 1024` validation in `resolvePoolRange` to prevent privileged port ranges from being configured silently.
2. Address MI-2: add an explanatory note in `.ai/decision-log.md` or similar for the `cross-project.ts` / `order.ts` stub pattern so future maintainers understand the `knip.json` ignore entries.
