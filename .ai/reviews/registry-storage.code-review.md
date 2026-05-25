---
title: 'Registry Storage, Locking, and Stale Pruning'
source: '.ai/specs/registry-storage/registry-storage.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-24
reviewer: code-review-subagent
---

# Code Review: Registry Storage, Locking, and Stale Pruning

## Summary

Reviewed the registry-storage implementation (8 source files + 7 test files + 1 fixture) against the approved spec at `.ai/specs/registry-storage/registry-storage.md`. All critical-path correctness requirements are met: directory-mutex locking works correctly, atomic write semantics are sound, concurrent integration test uses real `child_process.fork`, and no `offset` field appears anywhere in the persisted schema. The most significant finding is a schema mismatch introduced by the `AllocationKey` reconciliation: `offsetOverride` from `src/worktree/key.ts` is now embedded in every in-memory `AllocationKey` and surfaces in tests, though `serializeRegistry` correctly strips it on write. Two missing `pw-allow-swallow` comments and the absence of a spec-required type-level assertion in `serialize.test.ts` are the remaining notes.

## Source

- **Spec:** `.ai/specs/registry-storage/registry-storage.md`
- **Feature doc:** `.ai/features/registry-storage/registry-storage.md`
- **Branch:** `jl/build-specs`
- **Files reviewed:** 16 (8 source, 7 test, 1 fixture)
- **Changes analyzed:** Full `src/registry/` subtree — paths, lock, serialize, atomic-write, prune, storage, storage.concurrent, types

## Accuracy Assessment

| Requirement                                                                                   | Status         | Notes                                                                                                             |
| --------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `resolveRegistryPath` honors `XDG_CONFIG_HOME` and falls back to `~/.config`                  | ✅ Implemented | Guarded against empty string too                                                                                  |
| Lock uses `fs.mkdir` POSIX atomic primitive                                                   | ✅ Implemented | `tryAcquire` catches EEXIST only; other errors propagate                                                          |
| `LOCK_RETRY_COUNT = 100`, `LOCK_RETRY_DELAY_MS = 25`, `STALE_LOCK_MS = 30_000`                | ✅ Implemented | Constants match boardflip spec exactly                                                                            |
| `PORTWEAVE_LOCK_TIMEOUT_MS` override derives retry count                                      | ✅ Implemented | `Math.ceil(parsed / LOCK_RETRY_DELAY_MS)`, min 1                                                                  |
| Budget exhaustion returns `err(PortweaveError(PW0301, ...))`, never throws                    | ✅ Implemented | Confirmed at `lock.ts:95–100`                                                                                     |
| `try/finally` releases lock on both success and `fn` throw                                    | ✅ Implemented | Lock released in `finally` block; throw propagates after                                                          |
| `loadRegistryFile` returns `ok({entries:[], version:1})` on ENOENT                            | ✅ Implemented |                                                                                                                   |
| `loadRegistryFile` returns `err(PW0302)` on malformed JSON or schema violation                | ✅ Implemented | Hand-rolled type guard, no zod                                                                                    |
| Unknown entry fields dropped silently (forward-compat hatch)                                  | ✅ Implemented | `parseEntry` reconstructs only known fields                                                                       |
| `serializeRegistry` stable key order, trailing newline, 2-space indent                        | ✅ Implemented | Sorted by `worktreeRoot` then `namespace`                                                                         |
| No `offset` field in persisted record                                                         | ✅ Implemented | `serializeRegistry` explicitly constructs key without `offsetOverride`                                            |
| `atomicWriteRegistry` writes to `*.tmp.<pid>.<timestamp>` then renames                        | ✅ Implemented |                                                                                                                   |
| Tempfile siblings older than 60s pruned on load                                               | ✅ Implemented | `pruneStaleTempFiles` called inside `withLock` before `loadRegistryFile`                                          |
| `pruneStaleEntries` checks `worktreeRoot` is a directory, not just exists                     | ✅ Implemented | `defaultDirectoryExists` uses `statSync().isDirectory()` — goes beyond spec's `existsSync` requirement, correctly |
| Pruning only drops entries whose path is missing                                              | ✅ Implemented |                                                                                                                   |
| Pure reads do not rewrite the file                                                            | ✅ Implemented | `state.mutated` guards the write; prune-triggered mutation does set `mutated = true`                              |
| `handle.touch(key)` bumps `lastUsedAt` without changing `ports`                               | ✅ Implemented |                                                                                                                   |
| `withRegistry` exposes `upsert`, `remove`, `touch`                                            | ✅ Implemented |                                                                                                                   |
| 8-subprocess concurrent integration test, no mocked `fs`                                      | ✅ Implemented | `child_process.fork` against real `concurrent-writer.ts` fixture                                                  |
| Decision-log rows #19 and #20 appended                                                        | ✅ Implemented | Rows appended at bottom of table                                                                                  |
| `AllocationKey` defined inline at `src/registry/types.ts`, re-exports from canonical location | ✅ Implemented | `types.ts` imports from `src/worktree/key.ts` and re-exports                                                      |

## Completeness Assessment

### Implemented

- `src/registry/paths.ts` — `resolveRegistryPath` with `RegistryPaths` interface
- `src/registry/lock.ts` — `withLock`, stale recovery, `PORTWEAVE_LOCK_TIMEOUT_MS`
- `src/registry/serialize.ts` — `loadRegistryFile`, `serializeRegistry`, hand-rolled guards
- `src/registry/atomic-write.ts` — `atomicWriteRegistry`, `pruneStaleTempFiles`
- `src/registry/prune.ts` — `pruneStaleEntries` with injectable `fsExists`
- `src/registry/storage.ts` — `withRegistry`, `WithRegistryHandle`, `buildHandle`
- `src/registry/storage.concurrent.ts` — path helper for concurrent test (structure-check shim)
- `src/registry/types.ts` — `RegistryEntry`, `RegistryFile`, `REGISTRY_VERSION`, re-export of `AllocationKey`
- All 7 test files and `fixtures/concurrent-writer.ts` present and covering all specified scenarios

### Missing or Incomplete

- **Type-level no-offset assertion missing.** The spec says: "asserted by a type-level test in `serialize.test.ts`" (AC row 3). The test at `serialize.test.ts:161–168` asserts at runtime that the serialized JSON string doesn't include `"offset"`. There is no compile-time assertion (e.g. `satisfies` / `Exclude` type check) that `RegistryEntry.key` does not expose `offsetOverride` in the on-disk type. This is MI-1.

### Beyond Scope

- `src/registry/storage.concurrent.ts` is a thin shim module created solely to satisfy the `structure:check` rule requiring a test to have a sibling source file. The spec doesn't mention it; this is a reasonable tooling accommodation, clearly commented, and does not affect runtime behavior.
- `defaultDirectoryExists` in `prune.ts` checks `statSync().isDirectory()` beyond the spec's `existsSync` requirement. This is a correct and safe improvement that prevents a path-is-a-file false positive.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: Spec requires a type-level assertion in `serialize.test.ts` that the persisted shape has no `offset` field — only a runtime string-check is present — `src/registry/__tests__/serialize.test.ts:161–168`
  - **Suggested fix:** Add a compile-time assertion alongside the runtime check:
    ```typescript
    // Type-level: persisted key must not include offsetOverride
    type SerializedKey = {
      gitCommonDir: null | string
      namespace: string
      worktreeRoot: string
    }
    type _NoOffset =
      keyof SerializedKey extends Exclude<keyof SerializedKey, 'offsetOverride'>
        ? true
        : never
    const _assertNoOffset: _NoOffset = true
    ```
    Or use a `satisfies` expression on `normalized` in `serializeRegistry` itself.

- **MI-2**: `tryRemoveStaleLock` catch block in `lock.ts` silently swallows the `stat` error and proceeds to `rm` — a permissions error on `stat` would incorrectly trigger forced removal of the lock directory — `src/registry/lock.ts:60–62`
  - **Suggested fix:** Narrow to ENOENT before unconditional removal, and add a `// pw-allow-swallow:` comment for the race-condition path:
    ```typescript
    } catch (caught: unknown) {
      // pw-allow-swallow: ENOENT means the lock vanished concurrently — no action needed.
      // Any other error is unexpected; remove forcefully as best-effort and let the
      // retry loop surface the failure.
      if (getErrorCode(caught) !== 'ENOENT') {
        await rm(lockDir, { force: true, recursive: true })
      }
    }
    ```

- **MI-3**: `defaultDirectoryExists` in `prune.ts` has a bare catch block with no `// pw-allow-swallow:` comment — `src/registry/prune.ts:10`
  - **Suggested fix:** Add the required comment:
    ```typescript
    } catch {
      // pw-allow-swallow: statSync failure after existsSync succeeds means the path
      // was removed between the two calls. Treat as non-existent.
      return false
    }
    ```

### 🟢 Suggestions

- **S-1**: The `offsetOverride: null` field that appears in every in-memory `AllocationKey` (from `src/worktree/key.ts`) is correctly stripped by `serializeRegistry`. However, the `parseKey` function in `serialize.ts:34` re-injects `offsetOverride: null` on deserialization, meaning all round-tripped keys carry the field even though the on-disk format never had it. This is technically correct for the registry's internal type but creates a subtle asymmetry — a future reader of `parseKey` might not realize `offsetOverride` is always null for registry-originated keys. A brief comment would prevent confusion — `src/registry/serialize.ts:34`
  - **Rationale:** The spec notes this reconciliation explicitly; a `// offsetOverride is not persisted — always null on deserialization` comment would surface the contract without code changes.

- **S-2**: `withLock` signature accepts `fn: () => Promise<T>`, but `withRegistry` passes an async closure that returns `InnerOutcome<T>`. If `fn` throws synchronously (not returns a rejected promise), the `try/finally` still catches it. However, the outer `withRegistry` only handles the `lockResult.ok === false` path — a synchronous throw inside the lock would propagate past `withRegistry` without releasing lock metadata in the `Result` shape. The current `try/finally` in `withLock:85–90` does cover this, but it's worth a test confirming the lock is released on `fn` synchronous throw (the existing test covers a sync throw but the error propagates out of `withLock` unhandled — the `withRegistry` caller would see an unhandled promise rejection) — `src/registry/storage.ts`
  - **Rationale:** Already protected by the `finally` block; adding a test that `withRegistry` caller sees a rejected promise (not a hung lock) after a synchronous `fn` throw would close the coverage gap.

## Potential Issues

- **P-1**: `resolveLockConfig()` reads `process.env.PORTWEAVE_LOCK_TIMEOUT_MS` at the start of every `withLock` call (runtime). In a test environment where multiple tests mutate `process.env.PORTWEAVE_LOCK_TIMEOUT_MS`, test isolation depends on cleanup order. The `lock.test.ts` `afterEach` correctly restores the original value, but the restoration uses the module-level `originalEnv` snapshot taken at import time. If tests within the suite run in a different order (e.g., Vitest parallelism), the captured `originalEnv` could be stale — `src/registry/__tests__/lock.test.ts:11`
  - **Risk:** Test flakiness under parallel execution if `PORTWEAVE_LOCK_TIMEOUT_MS` is set in the outer environment at test-suite start.
  - **Recommendation:** Capture `originalEnv` inside `beforeEach` rather than at module level, or use Vitest's `vi.stubEnv` for deterministic isolation.

- **P-2**: The 8-subprocess concurrent test at `storage.concurrent.test.ts` passes `execArgv: ['--import', 'tsx']` to `fork`. This works only when `tsx` is available on `PATH` at the `execArgv` level. In CI environments that install Node via a version manager (e.g., `n`, `nvm`) with a non-default PATH for child processes, the tsx binary might not be found, causing all 8 workers to fail with `MODULE_NOT_FOUND`. The test timeout is 30s which is generous, but the failure mode is 8 `code: null` exits with opaque errors — `src/registry/__tests__/storage.concurrent.test.ts:45`
  - **Risk:** Intermittent CI failures on certain runner configurations.
  - **Recommendation:** Resolve the `tsx` binary path explicitly using `require.resolve('tsx/dist/cli.mjs')` or the `which`/`node_modules/.bin/tsx` path, and pass it as `--import` with an absolute path.

- **P-3**: `serializeRegistry` sorts entries by `(worktreeRoot, namespace)` to produce a deterministic on-disk order, but the sort is applied only at serialize time — `withRegistry` exposes `handle.entries` in insertion order. If a caller iterates `handle.entries` and depends on sorted order (e.g., the allocator scanning for the next free block), the in-memory order differs from disk order. This isn't a bug today but could become one when the allocator (Feature #5) uses `handle.entries` as its scan input — `src/registry/storage.ts:36–40`
  - **Risk:** Allocator might traverse entries in an unexpected order, producing non-deterministic block assignments.
  - **Recommendation:** Document the exposure: `handle.entries` is insertion-ordered, not sort-ordered. Allocator callers should not rely on sort order of the in-memory view.

## Code Quality

### Patterns & Consistency

The implementation is structurally consistent throughout. Every public function either returns `Result<T, PortweaveError>` for fallible operations or returns `void`/plain values for infallible ones. Internal helpers (`tryAcquire`, `tryRemoveStaleLock`, `parseKey`, `parsePorts`, `parseEntry`) are all private and correctly scoped. The `MutableHandleState` pattern in `storage.ts` cleanly separates mutable state from the immutable handle interface. `keysEqual` uses exactly the three lookup fields the spec mandates — it correctly excludes `offsetOverride` from equality. Naming is consistent with the spec throughout.

### Error Handling

All catch variables in public-facing code are typed `unknown` with proper narrowing (`serialize.ts:104,124`, `lock.ts:69`, `atomic-write.ts:21`). The `pruneStaleTempFiles` swallow at `atomic-write.ts:43` carries the required `// pw-allow-swallow:` comment with rationale. Two other catch blocks (`prune.ts:10`, `lock.ts:60`) silently swallow without the required comment — flagged as MI-2 and MI-3. `PortweaveError` correctly calls `Object.setPrototypeOf` (inherited from the existing `errors.ts` implementation, verified). No floating promises found.

### Type Safety

No `any` types introduced. All `import type` declarations are used where values aren't needed. Relative imports use `.ts` extensions throughout. The `offsetOverride: null` injection in `parseKey` (serialize.ts:34) is typed correctly as `AllocationKey` since the canonical type includes `offsetOverride: null | number`. `serializeRegistry` explicitly constructs the key shape without `offsetOverride`, so the on-disk format is clean.

### Test Coverage

All 15 acceptance criteria have corresponding tests. Real I/O is used throughout (temp dirs from `os.tmpdir()`). The concurrent test uses real `child_process.fork` with no mocked `fs`. Edge cases covered: ENOENT on first load, schema violations (7 variants), stale-lock recovery, budget exhaustion, tempfile cleanup, pure-read no-rewrite, touch no-op on missing key, prune-on-mutation. One gap: the spec requires a type-level no-offset assertion in `serialize.test.ts`; only a runtime check is present (MI-1).

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 3     |
| 🟢 Suggestions      | 2     |
| ⚠️ Potential Issues | 3     |

### Required Actions

None — no critical or major findings block ship.

### Recommended Actions

1. Address MI-1: Add a compile-time type assertion in `serialize.test.ts` that the persisted key shape excludes `offsetOverride`.
2. Address MI-2: Narrow the ENOENT case in `tryRemoveStaleLock` catch block and add `// pw-allow-swallow:` with rationale.
3. Address MI-3: Add `// pw-allow-swallow:` comment to the `defaultDirectoryExists` catch block in `prune.ts`.
4. Address P-1: Move `originalEnv` capture inside `beforeEach` in `lock.test.ts`, or switch to `vi.stubEnv`.
5. Address P-2: Resolve the `tsx` binary path absolutely in `storage.concurrent.test.ts` to prevent CI `PATH` issues.
