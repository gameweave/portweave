# Registry storage, locking, and stale pruning

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/registry-storage/registry-storage.md](../../features/registry-storage/registry-storage.md)
**Decision-log rows:** [#3](../../decision-log.md) (stateless file-locked, no daemon), [#4](../../decision-log.md) / [#9](../../decision-log.md) (machine-wide pool — no per-project offset field), [#8](../../decision-log.md) (XDG registry path), [#17](../../decision-log.md) (PW error-code numbering — this feature is the first user of the `PW03xx` registry block)

## Problem

Portweave's only durable promise is "two worktrees, two projects, two coding agents on the same machine never collide on a port." That promise is upheld by the registry: every claim is read from and written back to a single file-locked JSON document at `~/.config/portweave/registry.json` ([DESIGN.md §5.3](../../DESIGN.md), [§5.6](../../DESIGN.md)). The allocator (Feature #5), the `run` and `show` commands, and the library runtime all sit on top of this layer. If two callers can race past the lock, the guarantee breaks. If a crashed caller can leave a lock behind, the next caller hangs forever. If a half-written registry can survive a kill -9, the next reader sees a corrupt file and every Portweave invocation on the machine starts failing until someone hand-edits the file. And without pruning, every deleted git worktree leaks its block forever and the pool slowly bleeds out.

This is the storage half of the Gameweave parity goal ([DESIGN.md §7.2 rows 2 and 7](../../DESIGN.md)). Gameweave's internal file-locked registry helper is battle-tested in a real multi-worktree workflow; Portweave reimplements the same coordination shape with two structural changes — the record schema drops the `offset` field (Portweave is a machine-wide pool, not a per-project offset multiplier — [decision-log row #4](../../decision-log.md)) and the file moves from `gitCommonDir` to the XDG user-config location ([decision-log row #8](../../decision-log.md)). Everything else — directory-mutex locking, bounded retries, stale-lock TTL, atomic temp+rename writes, prune-on-read — carries over.

## Approach

Five source files plus a tests directory under `src/registry/`. The public surface that Feature #5 (port-allocator) consumes is a single `withRegistry(fn)` helper that handles locking, loading, pruning, mutation, and atomic save in one call. Internal building blocks are testable in isolation.

### Record schema and on-disk shape

Per [decision-log row #4](../../decision-log.md), the record has **no `offset` field**. The registry diverges from Gameweave's prior art at exactly this point. The on-disk file is JSON:

```jsonc
{
  "version": 1,
  "entries": [
    {
      "key": {
        "gitCommonDir": "/Users/x/repos/foo/.git",
        "namespace": "main",
        "worktreeRoot": "/Users/x/repos/foo",
      },
      "lastUsedAt": "2026-05-23T17:42:11.000Z",
      "namespace": "main",
      "ports": { "api": 30100, "vite": 30101, "ws": 30102 },
    },
  ],
}
```

The `key` shape is what Feature #3 (worktree-context) produces. Carrying `namespace` both inside `key` and at the top of the record is intentional — the key is what identifies a worktree; the top-level `namespace` is the value PM2 / log consumers read out (DESIGN.md §7.2 row 4, modeled on Gameweave's internal namespace-derivation helper). Feature #3 owns the derivation; this feature only stores what it's given.

`ports` is a `{ [serviceName]: number }` map. `lastUsedAt` is an ISO-8601 string for human readability when someone `cat`s the file.

### `src/registry/paths.ts` — XDG path resolution

One function: `resolveRegistryPath(env: NodeJS.ProcessEnv = process.env): { registryFile: string; lockDir: string; registryDir: string }`. Honors `XDG_CONFIG_HOME` per the spec; falls back to `path.join(os.homedir(), '.config')`. Returns:

- `registryDir`: `<config>/portweave/`
- `registryFile`: `<registryDir>/registry.json`
- `lockDir`: `<registryDir>/registry.lock` (directory, not a file — see §Locking)

This file does no I/O. Callers ensure `registryDir` exists with `fs.mkdir(registryDir, { recursive: true })` on first write.

### `src/registry/lock.ts` — directory-mutex with bounded retries and stale-lock recovery

Mirrors Gameweave's internal file-locked registry helper. The atomic primitive is `fs.mkdir(lockDir)` — POSIX guarantees `mkdir` of an existing directory fails with `EEXIST`, so the create-or-fail race is resolved by the kernel. Implementation pins:

- **Retry budget:** `LOCK_RETRY_COUNT = 100`, `LOCK_RETRY_DELAY_MS = 25`. Worst-case wait ≈ 2.5s. Matches Gameweave exactly so debugging is the same.
- **Stale-lock TTL:** `STALE_LOCK_MS = 30_000`. If the existing lock directory's `mtimeMs` is older than 30s, the next retry first removes it (`fs.rm(lockDir, { force: true, recursive: true })`), then loops. Matches Gameweave.
- **Sleep primitive:** use `setTimeout` via `await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS))` rather than Gameweave's `Atomics.wait` SharedArrayBuffer trick — Portweave is async-first (Vite/Next config call sites in Feature #9 are async, so the registry path must be async-friendly), and the SharedArrayBuffer trick is a workaround for sync code paths Gameweave needed but Portweave doesn't.
- **Lock timeout override:** read `process.env.PORTWEAVE_LOCK_TIMEOUT_MS` once at start of `acquireLock`. If set and parseable as a positive integer, treat it as the total wait budget in ms and derive retry count from `Math.ceil(timeout / LOCK_RETRY_DELAY_MS)`. No CLI flag at v0 ([roadmap §4](../../roadmaps/v0-roadmap.md) and feature doc).
- **Failure mode:** after the budget is exhausted, return `err(new PortweaveError(PW_ERROR_CODES.REGISTRY_LOCKED, ...))` — never throw. This is the first real consumer of `REGISTRY_LOCKED` ([PW0301](../result-types/result-types.md)).
- **Release:** the `try/finally` around `fn()` always runs `fs.rm(lockDir, { force: true, recursive: true })`. If `fn` itself throws, the lock is released before the throw propagates; if `fn` returns a `Result`, the lock is released before returning.

Public API:

```typescript
export function withLock<T>(
  lockDir: string,
  fn: () => Promise<T>,
): Promise<Result<T, PortweaveError>>
```

### `src/registry/serialize.ts` — load, parse, and validate

- `loadRegistryFile(path: string): Promise<Result<RegistryFile, PortweaveError>>`. Returns `ok({ version: 1, entries: [] })` if the file does not exist (first-run case — not an error). Returns `err(REGISTRY_CORRUPT)` (PW0302) on `JSON.parse` failure or schema-shape failure. Uses a minimal hand-rolled type guard rather than zod here — the registry is internal, schemas don't need cross-tool stability, and pulling zod into the registry hot path is unnecessary weight. (Feature #2 — config-loader — uses zod because user-authored input has different requirements.)
- `serializeRegistry(file: RegistryFile): string`. Stable key order via the existing perfectionist sort rules; trailing newline; 2-space indent. Determinism matters because the registry is often diffed by humans.
- Schema validation: every entry must have `key.worktreeRoot: string`, `key.namespace: string`, `ports: Record<string, number>`, `lastUsedAt: string` (ISO-8601 parse check), `namespace: string`. `key.gitCommonDir` may be `null` (non-git fallback per [DESIGN.md §5.4](../../DESIGN.md)). Unknown fields are dropped silently — this is the forward-compat hatch for future schema additions.

### `src/registry/atomic-write.ts` — temp-file + rename atomic save

One function: `atomicWriteRegistry(path: string, contents: string): Promise<void>`. Writes to `${path}.tmp.${process.pid}.${Date.now()}` (unique-per-process tempfile, avoids collision when two concurrent writers both make it past the lock — they can't, but defense in depth) then `fs.rename` to the final path. Rename is atomic on the same filesystem per POSIX. A crashed process between write and rename leaves the tempfile behind; a small prune step in `loadRegistryFile` cleans up `*.tmp.*` siblings older than 60s.

### `src/registry/prune.ts` — drop entries whose worktree path is gone

```typescript
export function pruneStaleEntries(
  entries: RegistryEntry[],
  fsExists: (path: string) => boolean = existsSync,
): RegistryEntry[]
```

For every entry, check whether `entry.key.worktreeRoot` exists as a directory on disk. If not, drop it. The `fsExists` parameter is for testability — production passes `existsSync`. Unrelated repos' entries are untouched because we only check the entry's own path, never enumerate.

Pruning runs on every `withRegistry` call before `fn` sees the entries. The pruned shape is the one that gets written back, so the file self-heals on the next mutation. A pure read with no mutations does not rewrite (avoids gratuitous lock churn and disk writes — important when `portweave show` runs in a tight introspection loop).

### `src/registry/storage.ts` — public surface

```typescript
export interface WithRegistryHandle {
  readonly entries: readonly RegistryEntry[]
  upsert(entry: RegistryEntry): void
  remove(key: AllocationKey): void
  touch(key: AllocationKey): void // bump lastUsedAt without mutating ports
}

export function withRegistry<T>(
  fn: (handle: WithRegistryHandle) => Promise<T> | T,
): Promise<Result<T, PortweaveError>>
```

Internally: resolve paths → ensure `registryDir` exists → `withLock(lockDir, async () => { load → prune → build handle → await fn(handle) → if mutated, serialize+atomic-write → return T })`. The handle is a mutable view exposed only inside the `fn` callback; once `withRegistry` returns, the handle is discarded.

`touch` is what `portweave show` and the lookup path use to bump `lastUsedAt` on a hit without changing the ports — satisfies the feature doc's "lastUsedAt updates on lookup, not only on claim" criterion.

### `AllocationKey` shape (cross-feature contract)

```typescript
export interface AllocationKey {
  readonly gitCommonDir: string | null
  readonly namespace: string
  readonly worktreeRoot: string
}
```

This is produced by Feature #3 (worktree-context). For v0, this spec defines the type inline at `src/registry/types.ts` and re-exports it; Feature #3 lands and the import is flipped to the canonical location. Entry equality is by `(gitCommonDir, worktreeRoot, namespace)` triple — `worktreeRoot` alone is unique on a single machine, but including the other two prevents accidental cross-key collisions if a future feature ever reuses the same `worktreeRoot` across namespaces (e.g. a single worktree running two simultaneously-namespaced allocations — not a v0 case, but the equality check is cheap).

### Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), all tests live in `src/registry/__tests__/`. Real I/O against `os.tmpdir()` is preferred over mocks; lock behavior and atomic writes only have meaning against a real filesystem.

- `src/registry/__tests__/paths.test.ts` — `XDG_CONFIG_HOME` honored; fallback to `~/.config`; lock and registry paths nest correctly.
- `src/registry/__tests__/serialize.test.ts` — round-trip for a populated file; missing file returns empty; malformed JSON returns `PW0302`; schema violations (missing fields, wrong types, bad ISO-8601) return `PW0302`; unknown fields silently dropped.
- `src/registry/__tests__/atomic-write.test.ts` — tempfile cleanup; rename atomicity (use a writer that crashes mid-write via a forced exception and assert the original file is intact).
- `src/registry/__tests__/prune.test.ts` — entries with missing `worktreeRoot` dropped; entries with present `worktreeRoot` kept; the function does not touch the filesystem when called with a stub `fsExists`.
- `src/registry/__tests__/lock.test.ts` — single-process: `withLock` acquires and releases; stale-lock recovery: pre-create a lock dir, `utimes` its mtime to 31s ago, assert the next caller reclaims it; budget exhaustion: hold a lock past the configured budget, assert the next caller gets `PW0301`; `PORTWEAVE_LOCK_TIMEOUT_MS` honored.
- `src/registry/__tests__/storage.test.ts` — `withRegistry` happy path; `touch` bumps `lastUsedAt`; pure reads do not rewrite the file (assert by capturing `mtimeMs` before and after); mutations rewrite atomically.
- **`src/registry/__tests__/storage.concurrent.test.ts`** — the load-bearing integration test. Spawns N=8 real subprocesses (`child_process.fork` against a small helper script under `src/registry/__tests__/fixtures/concurrent-writer.ts`), each acquires `withRegistry`, performs an `upsert` with a unique `worktreeRoot`, and exits. Parent asserts: every subprocess exited 0; the final registry on disk has exactly N distinct entries (no torn writes, no lost updates); every `worktreeRoot` shows up exactly once. This is the spec's mocks-are-not-acceptable criterion — concurrent-write correctness is not provable from mocked `fs`.

Coverage thresholds in `vitest.shared.ts` (80% across all four metrics) apply per [.claude/rules/testing.md](../../../.claude/rules/testing.md).

### Decision-log impact

Two new rows to append on `Status: shipped` (not on `draft` — only when implementation ratifies the choices):

- A row documenting the `PORTWEAVE_LOCK_TIMEOUT_MS` env-only configurability decision (env var, no CLI flag at v0).
- A row documenting the temp-file naming scheme (`${path}.tmp.${pid}.${Date.now()}`) and the 60s sibling-cleanup window, so a future maintainer doesn't have to re-derive why both safeguards exist.

## Acceptance criteria

- [ ] `src/registry/paths.ts` exports `resolveRegistryPath` which honors `XDG_CONFIG_HOME` and falls back to `path.join(os.homedir(), '.config')`, verified by `src/registry/__tests__/paths.test.ts`.
- [ ] `src/registry/serialize.ts` round-trips a populated registry file; returns `ok` with an empty registry when the file does not exist; returns `err(PortweaveError)` with `code === PW_ERROR_CODES.REGISTRY_CORRUPT` on malformed JSON or schema violation, verified by `src/registry/__tests__/serialize.test.ts`.
- [ ] Registry records have **no `offset` field** — the persisted shape is exactly `{ key: AllocationKey, ports: Record<string, number>, lastUsedAt: string, namespace: string }`, asserted by a type-level test in `serialize.test.ts` and a runtime shape assertion.
- [ ] `src/registry/atomic-write.ts` writes to a unique tempfile (`*.tmp.<pid>.<timestamp>`) and renames into place; a writer that crashes mid-write leaves the original file intact and readable, verified by `src/registry/__tests__/atomic-write.test.ts`.
- [ ] `src/registry/prune.ts#pruneStaleEntries` drops entries whose `worktreeRoot` no longer exists and preserves entries whose path is present, verified by `src/registry/__tests__/prune.test.ts` with an injected `fsExists` predicate.
- [ ] `src/registry/lock.ts#withLock` acquires the directory mutex via `fs.mkdir`, runs `fn`, and releases on both success and failure paths, verified by `src/registry/__tests__/lock.test.ts`.
- [ ] A lock directory whose `mtimeMs` is older than 30s (`STALE_LOCK_MS`) is reclaimed automatically by the next caller without manual intervention, verified by `src/registry/__tests__/lock.test.ts` using `fs.utimes` to age the lock.
- [ ] When a lock cannot be acquired within the retry budget, `withLock` returns `err(PortweaveError)` with `code === PW_ERROR_CODES.REGISTRY_LOCKED`. The function never hangs unboundedly, verified by `src/registry/__tests__/lock.test.ts`.
- [ ] `PORTWEAVE_LOCK_TIMEOUT_MS` overrides the default retry budget when set to a positive integer, verified by `src/registry/__tests__/lock.test.ts`.
- [ ] `src/registry/storage.ts#withRegistry` exposes a `WithRegistryHandle` whose `upsert`, `remove`, and `touch` methods mutate an in-memory view that is then atomically persisted; the handle is discarded after `fn` returns, verified by `src/registry/__tests__/storage.test.ts`.
- [ ] A `withRegistry` call that performs no mutations does not rewrite the file (asserted by capturing `mtimeMs` before and after), verified by `src/registry/__tests__/storage.test.ts`.
- [ ] `handle.touch(key)` updates the entry's `lastUsedAt` to the current time without changing its `ports`, verified by `src/registry/__tests__/storage.test.ts`.
- [ ] **Concurrent writers from 8 real subprocesses serialize correctly**: every subprocess exits 0, the final on-disk registry contains exactly 8 distinct entries (no torn writes, no lost updates), and every `worktreeRoot` appears exactly once. Verified by `src/registry/__tests__/storage.concurrent.test.ts` using `child_process.fork` against the helper at `src/registry/__tests__/fixtures/concurrent-writer.ts`. Mocked `fs` is not acceptable for this criterion.
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across statements / branches / functions / lines) are met for every new source file.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`. (The `similarity:check` and `docs:freshness:check` steps may be skipped per the workflow rules and do not block this AC.)
- [ ] Two decision-log rows are appended on `Status: shipped` capturing (a) the `PORTWEAVE_LOCK_TIMEOUT_MS` env-only configurability decision and (b) the tempfile naming scheme + 60s sibling-cleanup window.

## Open questions

- **Tempfile sibling-cleanup window.** The approach above garbage-collects `*.tmp.*` siblings older than 60s on every load. Sixty seconds is the conservative default — long enough that a slow write on a sluggish disk completes, short enough that a crashed writer's tempfile doesn't linger across multiple invocations. Worth flagging because no existing decision pins this value; the roadmap and feature doc don't address tempfile lifecycle at all. If approval surfaces a different number, update before promoting `Status: approved`.
