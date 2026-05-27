# Port allocator and live conflict probe

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/port-allocator/port-allocator.md](../../features/port-allocator/port-allocator.md)
**Decision-log rows:** [#4](../../decision-log.md) / [#9](../../decision-log.md) (machine-wide pool), [#17](../../decision-log.md) (PW error-code numbering — this feature is the first user of the `PW04xx` allocator block; `ALLOCATION_EXHAUSTED=PW0401` is already seeded in [src/errors.ts](../../../src/errors.ts))

## Problem

Portweave's central promise — "two worktrees, two projects, two coding agents on the same machine never collide on a port" — is delivered by this layer. Everything upstream is plumbing (config inventory, worktree identification, file-locked storage) and everything downstream is presentation (env injection, CLI banners, library entry points). The allocator is the place where the [machine-wide pool model](../../DESIGN.md) becomes a real, observable guarantee.

Three converging contracts ([feature doc](../../features/port-allocator/port-allocator.md)):

1. **Two simultaneous worktrees of the same repo never overlap.** Gameweave's per-project offset solved this within one project; Portweave preserves it under a machine-wide model.
2. **Unrelated projects on the same machine never collide.** This is the model change versus Gameweave ([DESIGN.md §5.1](../../DESIGN.md), [§7.2 row 14](../../DESIGN.md)). Two repos both defaulting to Vite 5173 must come up cleanly side-by-side.
3. **Externally-bound ports are detected before allocation, not on the child process's first connection failure** ([§7.2 row 13](../../DESIGN.md)). A port the registry believes free but some non-Portweave process is already listening on must be skipped at allocation time.

Stickiness and all-services-move-together are also load-bearing. A given allocation key returns the same contiguous block across runs (as long as those ports remain free), and grouped services like Kinesis plain + Kinesis TLS stay adjacent so dual-port services move as a unit ([§7.2 row 10](../../DESIGN.md)).

This is the "heart of the system" entry from the v0 roadmap — every shipped feature so far (`config-loader`, `worktree-context`, `registry-storage`) exists to feed inputs into this one, and every downstream feature (env-resolution, run/show commands, library runtime, parity-verification) consumes its output.

## Approach

Three source files plus a tests directory under `src/allocator/`. The public surface for downstream features (env-resolution, run-command, library-runtime) is a single `allocate(key, config)` entry point that handles lookup, probe-based reuse validation, block search, and registry mutation in one call.

### Public surface and types

The allocator exposes one entry point and re-uses the registry-storage record shape. Define both in `src/allocator/allocate.ts` so env-resolution can import them by path without reaching into the registry module's internals:

```typescript
import type { Config } from '../config/index.ts'
import type { PortweaveError } from '../errors.ts'
import type { Result } from '../result.ts'
import type { AllocationKey, RegistryEntry } from '../registry/types.ts'

// Allocation is the conceptual layer on top of a RegistryEntry — same shape,
// re-exported here so downstream features depend on the allocator's surface
// rather than reaching into registry types.
export type Allocation = RegistryEntry

export interface AllocationResult {
  readonly allocation: Allocation
  readonly reused: boolean // true on sticky lookup; false on fresh block
}

export function allocate(
  key: AllocationKey,
  config: Config,
  env?: NodeJS.ProcessEnv,
): Promise<Result<AllocationResult, PortweaveError>>
```

`reused` is exposed on the result (not on `Allocation` itself) so the `RegistryEntry` shape remains the on-disk truth. The CLI banner ([Feature #7](../../features/run-command/run-command.md)) uses `reused` to print "reusing existing allocation" vs. "allocated"; env-resolution ignores it.

### `src/allocator/pool.ts` — block-search algorithm

One function: `findFreeBlock(occupiedSorted, slotCount, range) → number | null`.

- **Pool range:** default `[30000, 60000)` (`POOL_START_DEFAULT = 30000`, `POOL_END_DEFAULT = 60000`). 30,000 candidate ports leaves comfortable headroom past Docker/Postgres/Redis defaults below 30k and avoids the ephemeral-port range (typically 49152+ on Linux, 49152–65535 on macOS by default; 60k upper bound keeps a 5k buffer). Override via `PORTWEAVE_POOL_RANGE` (format `"<start>-<end>"`, exclusive upper bound to match the default). Non-positive, malformed, or non-integer values fall back silently to the default — same precedent as `PORTWEAVE_LOCK_TIMEOUT_MS` ([decision-log #19](../../decision-log.md)).
- **Direction:** ascending from `range.start`. Predictable, debuggable, matches Gameweave's "low offsets first" intuition.
- **Algorithm:** linear scan. Given a sorted array of currently-occupied ports (union of every other entry's `ports` values across the registry, plus any ports the current attempt has discovered to be externally bound), advance a `start` cursor. For each candidate `[start, start + slotCount)` window, if it overlaps any occupied port, jump `start` past the conflict (`occupied + 1`). Otherwise return `start`. If `start + slotCount > range.end`, return `null` (pool exhausted).
- The function is pure — no I/O. The probe loop in `allocate.ts` calls it repeatedly, each call passing an enlarged "occupied" set as probes fail. This keeps the search algorithm trivially testable.

### `src/allocator/probe.ts` — TCP listen probe

One function: `probePort(port) → Promise<'free' | 'taken'>`.

- Implementation: `net.createServer().listen(port, '127.0.0.1')`. On `'listening'` resolve `'free'` after immediate `close()`. On `'error'` with `EADDRINUSE`, resolve `'taken'`. On any other error, treat as `'taken'` (defensive — permissions/sandbox issues should not silently consume the port, but should still cause the allocator to skip the port and keep searching).
- Binds to `127.0.0.1` explicitly, not `0.0.0.0`. We only care about loopback availability — that's where dev servers bind. Binding to `0.0.0.0` would falsely flag ports as free when an interface-specific listener exists on a different address.
- Probe is single-shot: one `createServer + listen + close` per call. No retries, no timeout — Node resolves the listen event near-immediately on a free port. A truly hung probe would indicate kernel-level wedging, which is out of scope for v0.
- A helper `probeBlock(start, count) → Promise<{ allFree: true } | { allFree: false; firstTakenPort: number }>` is exported as a convenience for the main allocator loop. It probes sequentially (not in parallel) so that on the first hit we can short-circuit and skip past `firstTakenPort` in the next iteration of `pool.ts`.

### `src/allocator/allocate.ts` — top-level orchestrator

The `allocate` function performs the allocate-or-reuse flow inside a single `withRegistry` call:

1. **Service ordering.** Compute the allocation order from `config.services`: services that share a `group` label are kept adjacent (preserving their relative order within the group), groups appear in first-occurrence order, ungrouped services keep their original position relative to the groups. This is the only place the allocator imposes order on the config; the config-loader doesn't enforce group-adjacency, so the allocator re-derives it deterministically. The function `orderServicesForAllocation(config) → ServiceSpec[]` is pure and lives in `allocate.ts`.

2. **Enter the registry.** Call `withRegistry(async (handle) => { ... })` from [src/registry/storage.ts](../../../src/registry/storage.ts) so locking, pruning, and atomic save are all inherited from registry-storage.

3. **Lookup-and-validate (reuse path).** Find an existing entry by `keysEqual(entry.key, key)`. If found, probe every port in the entry's `ports` map. If all probes return `'free'`, the existing allocation is sticky-valid: call `handle.touch(key)` to bump `lastUsedAt`, then return `ok({ allocation: entry-with-fresh-lastUsedAt, reused: true })`. If any probe returns `'taken'`, the allocation is stale (something external is on one of the ports); fall through to fresh allocation, but first `handle.remove(key)` so the next loop sees the slot freed.

4. **Fresh allocation path.** Compute the set of `occupied` ports as the sorted union of all `entry.ports` values across `handle.entries` (excluding the current key if we removed it in step 3). Loop:
   - Call `findFreeBlock(occupied, orderedServices.length, range)`. If `null`, the entire pool is registry-occupied → return `err(PW0401)`.
   - Probe the candidate block via `probeBlock`. If `allFree`, build the new `RegistryEntry`, `handle.upsert(entry)`, return `ok({ allocation: entry, reused: false })`.
   - If a port is externally taken, add it to `occupied` (so the next `findFreeBlock` call jumps past it) and continue. Cap the probe-retry budget at `MAX_PROBE_RETRIES = 100` to bound worst-case work; on exhaustion return `err(PW0401)` with a message distinguishing "registry-saturated" from "externally-saturated".

5. **`offsetOverride` handling.** [AllocationKey](../../../src/worktree/key.ts) carries an `offsetOverride: number | null` field that worktree-context derived from `PORTWEAVE_OFFSET`. At v0 the allocator records the override in the entry's metadata if non-null but does not use it as a hint into the pool — the machine-wide pool always returns _some_ free block, never a "preferred" one ([DESIGN.md §5.1](../../DESIGN.md)). The override is preserved through the registry record for future hybrid-mode use ([decision-log row #9](../../decision-log.md) supersedes Gameweave's offset model; the field is plumbed for forward compatibility only). Out-of-scope for v0 is making the override actually influence the search.

### Service-group ordering function

```typescript
function orderServicesForAllocation(config: Config): ServiceSpec[] {
  const groupFirstSeen = new Map<string, number>()
  for (const [i, s] of config.services.entries()) {
    if (s.group !== undefined && !groupFirstSeen.has(s.group)) {
      groupFirstSeen.set(s.group, i)
    }
  }
  // Stable sort: ungrouped keeps its original index; grouped uses the
  // group's first-seen index, so grouped services slot together in
  // first-encounter order.
  return [...config.services].sort((a, b) => {
    const ai =
      a.group !== undefined
        ? (groupFirstSeen.get(a.group) ?? config.services.indexOf(a))
        : config.services.indexOf(a)
    const bi =
      b.group !== undefined
        ? (groupFirstSeen.get(b.group) ?? config.services.indexOf(b))
        : config.services.indexOf(b)
    if (ai !== bi) return ai - bi
    return config.services.indexOf(a) - config.services.indexOf(b)
  })
}
```

This guarantees: for any group, every service in the group is contiguous in the output; group order matches first-occurrence order in the source config; ungrouped services keep their original sequential position relative to the groups.

### Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), tests live in `src/allocator/__tests__/`. Real I/O against `os.tmpdir()` is preferred over mocks — the concurrent allocator test in particular only has meaning against the real filesystem and real `net` bindings.

- `src/allocator/__tests__/pool.test.ts` — `findFreeBlock` against synthetic occupied sets: empty pool, single-block-fits, multi-conflict skip, exhausted pool returns `null`, custom pool range honored.
- `src/allocator/__tests__/probe.test.ts` — `probePort` against a real `net.Server` bound on a known port returns `'taken'`; an unbound port returns `'free'`; `probeBlock` short-circuits on first-taken and returns the offending port.
- `src/allocator/__tests__/allocate.test.ts` — single-process flows: fresh allocation produces contiguous ports for an N-service config; rerun for the same key returns the same ports (`reused: true`); rerun after externally binding one of the ports allocates a fresh block (`reused: false`); pool exhaustion returns `err(PW0401)`; group-ordered services land contiguous in the output `ports` map.
- `src/allocator/__tests__/order.test.ts` — `orderServicesForAllocation` regroups scattered group members into contiguous adjacency without disturbing ungrouped service positions; first-occurrence group order is preserved; pure (no I/O).
- **`src/allocator/__tests__/allocate.concurrent.test.ts`** — the load-bearing integration test, mirroring [registry-storage's concurrent test](../../../src/registry/__tests__/). Spawns N=4 real subprocesses via `child_process.fork` against `src/allocator/__tests__/fixtures/concurrent-allocator.ts`, each calling `allocate` with a _distinct_ `AllocationKey` (simulating 4 worktrees of the same repo on the same machine). Parent asserts: every subprocess exited 0; the union of all 4 allocations contains no duplicate port across any service in any allocation; every allocation's ports are contiguous; every allocation lives within the configured pool range. Mocked `fs` or mocked `net` is not acceptable for this criterion — cross-project collision protection is not provable from mocked I/O.
- `src/allocator/__tests__/cross-project.test.ts` — within one process, allocate for two distinct repos (different `gitCommonDir`) with overlapping service names; assert the two allocations have non-overlapping port sets. This is the §7.2 row 14 assertion.

Coverage thresholds in `vitest.shared.ts` (80% across statements/branches/functions/lines) apply per [.claude/rules/testing.md](../../../.claude/rules/testing.md).

### Decision-log impact

Three new rows to append on `Status: shipped` (not on `draft` — only when implementation ratifies the choices):

- Pool-range default `[30000, 60000)` and the `PORTWEAVE_POOL_RANGE` env override (malformed values fall back silently to the default).
- Block-search direction = ascending (predictable and debuggable; revisit if observed wear concentrates on the low end of the pool).
- Service-group reordering rule (the `orderServicesForAllocation` algorithm) so future maintainers do not re-derive why services land where they do.

## Acceptance criteria

- [ ] `src/allocator/allocate.ts` exports `allocate(key, config, env?)` returning `Promise<Result<AllocationResult, PortweaveError>>` with `AllocationResult = { allocation: Allocation; reused: boolean }` and `Allocation = RegistryEntry`, callable from env-resolution without reaching into `src/registry/` internals.
- [ ] `src/allocator/pool.ts#findFreeBlock` is pure (no I/O), returns the first ascending port at which `slotCount` contiguous ports avoid every entry in `occupied`, and returns `null` when no such block fits within the pool range, verified by `src/allocator/__tests__/pool.test.ts`.
- [ ] Pool range defaults to `[30000, 60000)` and is overridable via `PORTWEAVE_POOL_RANGE="<start>-<end>"`. Malformed, non-integer, or inverted values fall back silently to the default, verified by `src/allocator/__tests__/pool.test.ts`.
- [ ] `src/allocator/probe.ts#probePort` returns `'taken'` for a port currently bound by a real `net.Server` and `'free'` for an unbound one. `probeBlock` resolves `{ allFree: false, firstTakenPort }` on the first conflict and `{ allFree: true }` when every port in the range is free, verified by `src/allocator/__tests__/probe.test.ts`.
- [ ] Service groups land contiguous within an allocation: for a config where two services share `group: "kinesis"` but are not adjacent in the source services array, the allocator reorders them so their ports are adjacent in the resulting `ports` map, verified by `src/allocator/__tests__/order.test.ts` and `allocate.test.ts`.
- [ ] Stickiness: a second `allocate` call with the same `AllocationKey` returns the same `ports` map as the first call and `reused: true`, provided every port still probes as `'free'`, verified by `src/allocator/__tests__/allocate.test.ts`.
- [ ] Live-conflict reuse invalidation: if any port in a stored allocation probes as `'taken'`, the entry is removed and a fresh block is allocated; the new allocation does not overlap the externally-bound port, verified by `src/allocator/__tests__/allocate.test.ts` using a real `net.Server` bound to one of the stored ports before the second `allocate` call.
- [ ] Fresh-allocation skip-on-probe-fail: when a candidate block contains an externally-bound port, the allocator advances past it and finds the next free block, verified by `src/allocator/__tests__/allocate.test.ts`.
- [ ] Pool exhaustion (no contiguous block large enough remains in the configured range) returns `err(PortweaveError)` with `code === PW_ERROR_CODES.ALLOCATION_EXHAUSTED` (`PW0401`). The function never loops unboundedly — probe retries are capped at `MAX_PROBE_RETRIES = 100`, verified by `src/allocator/__tests__/allocate.test.ts`.
- [ ] Allocation is performed inside `withRegistry` so locking, pruning, and atomic save semantics from registry-storage apply. Two `allocate` calls in the same process serialize through the registry lock without interleaved writes, verified by `src/allocator/__tests__/allocate.test.ts`.
- [ ] **Cross-worktree concurrent allocation correctness**: 4 real subprocesses each calling `allocate` with a distinct `AllocationKey` produce 4 allocations whose union has no duplicate port across any service. Verified by `src/allocator/__tests__/allocate.concurrent.test.ts` using `child_process.fork` against a fixture script. Mocked `fs` or `net` is not acceptable for this criterion.
- [ ] **Cross-project collision protection** ([§7.2 row 14](../../DESIGN.md)): two allocations for distinct `gitCommonDir` values within the same registry have non-overlapping port sets, verified by `src/allocator/__tests__/cross-project.test.ts`.
- [ ] `AllocationKey.offsetOverride` from worktree-context is plumbed through into the persisted `RegistryEntry` (so it survives round-tripping the registry) but does not influence v0 block selection — the override is preserved for forward compatibility per [decision-log row #9](../../decision-log.md). Verified by `src/allocator/__tests__/allocate.test.ts` reading back the stored entry.
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across statements / branches / functions / lines) are met for every new source file under `src/allocator/`.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.
- [ ] Three decision-log rows are appended on `Status: shipped` capturing (a) the pool-range default and `PORTWEAVE_POOL_RANGE` override, (b) the ascending block-search direction, and (c) the service-group reordering rule (`orderServicesForAllocation`).

## Open questions

- **Probe-retry budget.** `MAX_PROBE_RETRIES = 100` is the cap on how many times the allocator re-rolls when a candidate block has an externally-bound port. One hundred is generous enough that a moderately busy machine (a few dozen external bindings inside the pool range) still resolves cleanly, low enough that a pool-saturated pathological case returns an error in under a few seconds rather than appearing to hang. Worth flagging because no precedent pins this number; the retry-budget analogue in [registry lock retries](../../../src/registry/lock.ts) (100 × 25ms) was the inspiration. If approval surfaces a different number, update before promoting `Status: approved`.
- **Reuse path: probe vs. trust.** The reuse-after-probe-fail behavior treats _any_ taken port as invalidating the cached allocation, including the case where the user's _own_ dev server (from a prior `portweave run` in the same worktree) is currently bound. The alternative — trust the registry, let the dev server fail to bind, surface the conflict on bind error — is closer to Gameweave's behavior (Gameweave has no probe at all) and avoids surprise port-rotation when re-running while a server is up. The current spec follows the feature doc literally ("same ports as long as those ports remain free"), but the trade-off is real. Flagging in case the approval pass wants to flip this; if so, the probe-on-reuse step becomes "probe only the ports that don't match the stored entry's owner" — which we cannot determine without a marker file or pid record in the entry, expanding the registry schema. Recommend keeping the spec as written and revisiting only if real usage surfaces the friction.
