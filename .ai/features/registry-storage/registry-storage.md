---
name: registry-storage
title: Registry storage, locking, and stale pruning
roadmap_ref: .ai/roadmaps/v0-roadmap.md#4-registry-storage--registryjson-io-directory-mutex-locking-atomic-writes-stale-pruning
status: scoped
---

# Registry storage, locking, and stale pruning

## Why

Portweave's whole premise is that two worktrees, two projects, or two
simultaneously-started dev servers on the same machine never collide on a
port. That guarantee only holds if every claim is checked against — and
recorded into — a single source of truth that all Portweave processes agree
on. Without coordinated machine-wide state, two simultaneous worktrees can
inspect the registry at the same instant and claim overlapping port blocks
before either has written back. Without recovery for the coordination layer
itself, a crashed or force-killed process leaves a lock behind and the next
process waits forever for an owner that will never return. And without
pruning, every deleted worktree leaks its allocation forever, slowly eroding
the pool until users have to garbage-collect by hand.

This feature provides the durable, contention-safe substrate the allocator
and CLI sit on top of: a single registry file at a stable user-config
location, mutual exclusion that survives the messy realities of crashes and
stale state, atomicity so a half-written registry never replaces a good one,
and self-healing pruning so the pool stays clean without manual upkeep.

## Parity rows

DESIGN.md §7.2 row 2 (file-locked JSON registry with retry and stale-lock
cleanup) and row 7 (stale-entry pruning + last-used timestamps). Together
these are the storage half of the Gameweave parity goal — the allocator is
the other half.

## Dependencies

- [result-types](../result-types/result-types.md) — every fallible operation
  in this feature (acquire-lock, load-registry, save-registry, prune) returns
  a `Result<T, PortweaveError>` using the `PW`-prefixed error codes
  established there. In particular this feature is the first real consumer of
  the registry-locked and registry-corrupt codes.

## Gameweave reference

- Gameweave's file-locked registry helper (modeled on Gameweave's internal
  worktree-port system) is the canonical pattern this feature reimplements
  under Portweave's design. Notable inherited shapes:
  - Directory-mutex (`fs.mkdir` on a lock directory is the atomic primitive,
    not a lockfile written-then-checked).
  - Bounded retry loop (100 retries × 25ms ≈ 2.5s total wait) with a
    stale-lock TTL (30s) that lets a crashed owner's lock be reclaimed
    without operator intervention.
  - Atomic registry writes via temp-file + rename so a partially-written file
    can never be observed.
  - Prune-on-read: every load drops entries whose worktree path no longer
    exists, so the registry self-heals as worktrees come and go.

Per the design, Portweave keeps the file-locked coordination shape but lives
without a daemon — every CLI invocation is a one-shot that acquires the
lock, does its work, and releases. Gameweave's helper is the design
blueprint, not source imported at runtime.

## Scope

**In scope (v0):**

- A stable on-disk location for the registry under the user's XDG config
  directory, with parent directories created on first write.
- A registry record shape keyed by allocation key, carrying the per-service
  port map, a last-used timestamp, and a namespace. No per-project offset
  field — Portweave is a machine-wide pool, not Gameweave's per-project
  offset multiplier.
- A directory-mutex lock acquired before any read-modify-write of the
  registry, with bounded retries and automatic recovery from a stale lock
  left behind by a crashed prior owner.
- Atomic save semantics — readers either see the previous good registry or
  the new good registry, never a half-written one.
- Prune-on-read: entries whose worktree path no longer exists are dropped
  silently as part of every load. The on-disk file is rewritten with the
  pruned shape the next time a writer holds the lock.
- A `lastUsedAt` bump on both claim and lookup, so future garbage-collection
  policies have a recency signal that reflects real usage, not just the
  moment of first allocation.
- Typed `Result` errors for every public operation, including a
  registry-locked code (lock could not be acquired within the retry budget)
  and a registry-corrupt code (JSON parse failed or schema invariants
  violated).

**Out of scope (v0):**

- Multi-machine / networked coordination. The registry is single-host.
- Time-based garbage collection (drop entries older than N days). The
  pruning at v0 is presence-based — only deleted-worktree entries go. A
  recency-based sweep can land later on top of the `lastUsedAt` field this
  feature introduces.
- A migration framework for the registry schema. v0 ships one shape; future
  migrations are a later concern.
- Encryption, integrity checksums, or signing of the registry. The file is
  trusted within the user's own machine.
- Backups, history, or undo. The registry is rebuildable from the worktrees
  on disk; we don't need durability beyond "don't corrupt it."

## Acceptance criteria sketch

- Concurrent writers from N independent processes serialize correctly — no
  process observes a torn registry, and the final on-disk file contains
  every committed change. Verified with a real-subprocess integration test,
  not mocked filesystem.
- A lock left behind by a crashed prior owner is reclaimed automatically
  once it ages past the stale-lock threshold; the next caller does not
  require any manual intervention to proceed.
- A registry file that fails to parse (malformed JSON or schema violation)
  surfaces as a typed `Result` error in the registry-corrupt class. The
  caller can recover (e.g. report and exit cleanly); the library never
  crashes on bad input.
- A registry load whose set of worktree paths has changed since the last
  write returns a record set with entries for missing worktrees removed,
  while leaving entries for unrelated repos' worktrees untouched.
- A successful lookup (not just a claim) updates the entry's `lastUsedAt`,
  so an active worktree never appears stale to a future recency-based
  policy.
- Acquiring the lock when an active owner holds it within the retry budget
  results in a typed registry-locked error, not an unbounded hang.
- A write that fails partway through (process killed between temp-file and
  rename) leaves the prior registry intact and readable; the next reader
  sees the last-good state.

## Open questions

- Lock timeout configurability — env var (`PORTWEAVE_LOCK_TIMEOUT_MS`)? CLI
  flag? Recommend env var only at v0.
- Stale-lock TTL — match Gameweave's 30s, or shorter? Gameweave's value is
  battle-tested; **use 30s**.
