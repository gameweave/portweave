---
name: port-allocator
title: Port allocator and live conflict probe
roadmap_ref: .ai/roadmaps/v0-roadmap.md#5-port-allocator--block-selection-from-machine-wide-pool-live-conflict-probe-service-groups
status: scoped
---

# Port allocator and live conflict probe

## Why

This is the heart of Portweave — everything upstream is plumbing and
everything downstream is presentation. The allocator is the place where the
machine-wide-pool promise becomes a real, observable guarantee for users.

Three system-wide contracts converge here:

1. **Two simultaneous worktrees of the same repo must never receive
   overlapping ports.** A developer running `pnpm dev` in `main` and a
   feature worktree in parallel — or a coding agent spawning verification
   loops in three sibling worktrees — relies on each getting a disjoint
   block. Boardflip's per-project offset model already solves this within
   one project; the allocator is the piece that preserves that guarantee
   under Portweave's new model.

2. **Unrelated projects on the same machine must never collide on
   overlapping ports.** This is the model change versus boardflip
   (DESIGN.md §5.1 / §7.2 row 14). Two repos that both default to Vite
   5173 should both come up cleanly side-by-side without the user
   discovering the collision via a cryptic `EADDRINUSE`. The machine-wide
   pool exists for this reason and the allocator is what realizes it.

3. **Externally-bound ports must be detected before allocation, not on the
   child process's first connection failure** (§7.2 row 13). A port that
   the registry believes is free but some non-Portweave process happens to
   be listening on (Docker, an abandoned shell, an OS service) must be
   skipped at allocation time. By the time the dev server tries to bind,
   the answer must already be a known-good port.

Same-worktree stickiness (rerun gets the same ports) and the
all-services-move-together property are also load-bearing here: devtools
bookmarks, saved sessions, and grouped services like Kinesis-plain +
Kinesis-TLS all depend on the allocator returning a stable, contiguous
block for a given allocation key across runs.

## Parity rows

DESIGN.md §7.2:

- **Row 1** — the model change. Per-worktree block from a machine-wide
  pool instead of `base + offset*100`.
- **Row 10** — multi-port service groups (Kinesis-style pairs) allocate as
  a contiguous unit so dual-port services move together.
- **Row 13 (NEW)** — live conflict detection: probe each candidate port
  with a TCP listen before claiming it; skip and re-roll on `EADDRINUSE`.
- **Row 14 (NEW)** — cross-project collision protection: the whole reason
  the pool is machine-wide rather than per-project.

## Dependencies

- [config-loader](../config-loader/config-loader.md) — supplies the
  normalized service inventory the allocator consumes: how many ports to
  allocate, which services share a group (and therefore must land
  contiguous), and which env-var names the allocation gets keyed under for
  downstream injection.
- [worktree-context](../worktree-context/worktree-context.md) — supplies
  the `AllocationKey` (git common dir + worktree root + namespace) that
  the allocator uses to look up an existing entry or stamp a new one. This
  is the stickiness contract from DESIGN.md §5.4 in action.
- [registry-storage](../registry-storage/registry-storage.md) — provides
  the `withLock` substrate the allocator wraps every allocate-or-reuse
  flow in, the registry record shape it reads and writes, and the
  prune-on-read semantics that keep the pool free of dead allocations
  without manual cleanup.
- [result-types](../result-types/result-types.md) — every fallible step in
  the allocator (lock acquisition, pool exhaustion, repeated probe
  failures) surfaces as a `Result<T, E>` using the shared `PW`-prefixed
  error namespace, including the allocation-exhausted code seeded by that
  feature.

## Boardflip reference

- [reference/boardflip/packages/shared/src/worktree-ports.ts](../../../reference/boardflip/packages/shared/src/worktree-ports.ts)
  — inspires the _per-service shape_ only: a worktree's allocation is a
  map of named services to port numbers, all derived together so they
  move as a unit. **Portweave does NOT use boardflip's `base + offset*100`
  formula.** That formula is a per-project offset multiplier with a hard
  99-offset cap and no cross-project collision protection. Portweave
  replaces it with block selection from a machine-wide pool, with live
  conflict probing on each candidate port. The boardflip file is design
  inspiration for the per-service result shape; nothing under
  `reference/` is imported at runtime.

## Scope

**In scope (v0):**

- An allocate-or-reuse entry point that, given an `AllocationKey` and a
  `Config`, returns a typed `Result` carrying either an `Allocation`
  (per-service port map) or a typed error. If the key already has an
  entry whose ports are still valid (live conflict probe passes for each
  port), reuse the existing allocation. Otherwise allocate a fresh block.
- Block selection from a configurable pool range (suggested default
  `30000–60000`): find the next contiguous block large enough to cover
  the config's service count. Skip any port range that overlaps an
  existing registry entry's ports. Skip any port whose live probe says
  it's bound by an external process.
- A live conflict probe: attempt a TCP listen on `127.0.0.1:<port>`; on
  `EADDRINUSE` treat the port as externally taken and re-roll. Used both
  during fresh allocation and during reuse validation.
- Service-group contiguity: ports for services that share a `group` label
  in the config (e.g. Kinesis plain + Kinesis TLS) must be allocated as
  a contiguous unit so they move together across reallocations.
- Persistence: every fresh allocation is committed inside the
  `withLock`-bracketed read-modify-write cycle from the registry-storage
  feature, so two concurrent allocators never write overlapping blocks.
- Stickiness: a rerun for the same allocation key returns the same ports
  as long as none of them have been bound externally since the prior
  run.
- Typed `Result` errors for the failure modes callers must handle,
  including pool exhaustion (no contiguous block of the requested size
  available within the pool range after skipping registry-claimed and
  externally-bound ports).

**Out of scope (v0):**

- Honoring the config's `preferred` port hint as a real allocation
  preference. The hint is normalized through the config loader but
  ignored by the allocator at v0; the machine-wide pool always returns
  _some_ free block, never the "preferred" one (per DESIGN.md §5.1).
- A hybrid prefer-then-fallback allocation strategy. Logged for v1
  reconsideration in the design doc; not in v0.
- TTL-based allocations or `portweave release` for short-lived agent
  runs. That's a future-roadmap item.
- Cross-machine coordination. Each machine has its own registry, so the
  allocator operates against local state only.
- Recovery for the case where every candidate block fails the live probe
  because the entire pool range is externally saturated — surfaces as
  pool exhaustion at v0, with no automatic pool-range escalation.
- Allocation reservations or holds across processes beyond the lock-held
  read-modify-write window. Once written, the block is the worktree's
  until the entry is pruned.

## Acceptance criteria sketch

- Two simultaneous worktrees of the same project never receive
  overlapping port blocks, verified by a concurrent integration test
  using real subprocesses (not mocked filesystem or mocked locks).
- Two unrelated projects on the same machine never collide on
  overlapping ports — the machine-wide pool guarantee from §7.2 row 14
  holds in practice.
- An externally-bound port (something is listening on it outside
  Portweave) is skipped during allocation rather than assigned, per §7.2
  row 13.
- Services that share a group land on contiguous ports within an
  allocation, so dual-port services move together.
- The same worktree on rerun gets the same ports as long as those ports
  remain free — the stickiness contract from DESIGN.md §5.4 holds.
- Pool exhaustion (no contiguous free block large enough for the config)
  surfaces as a typed `Result` error in the `PW`-prefixed namespace,
  not a crash or an unbounded loop.

## Open questions

- Default pool range — `30000–60000`? Configurable per machine via
  `~/.config/portweave/portweave.toml` (or similar)? Recommend hardcoded
  default at v0, env override `PORTWEAVE_POOL_RANGE`.
- Block-search direction — ascending from low, or random within pool?
  Ascending is simpler and predictable; recommend **ascending**.
