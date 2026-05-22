---
name: result-types
title: Result types and PW error codes
roadmap_ref: .ai/roadmaps/v0-roadmap.md#1-result-types--resulttee-primitives--pw-error-codes
status: shipped
---

# Result types and PW error codes

## Why

Portweave's whole job is to coordinate fallible operations against shared
state — claiming ports out of a registry, acquiring a directory mutex, loading
project config, recovering from a stale lock. Most of those failures are
_expected_ — the caller needs to recover (retry, surface a friendly message,
fall back), not crash. Without a shared typed-Result primitive and a unified
error-code namespace, every feature would either re-invent the error-handling
pattern locally or default to throw-everywhere, leaking implementation noise
into callers and making it harder for users to script around predictable
failure modes. Establishing the foundation first means every subsequent
feature — registry, allocator, config loader, CLI — reaches for the same
shape from day one.

## Parity rows

Foundation. No DESIGN.md §7.2 parity row of its own; underpins every row that
follows.

## Dependencies

None — this is the foundation. Every other v0 feature builds on top of it.

## Boardflip reference

None — see [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md)
for the contract this feature formalizes.

## Scope

**In scope (v0):**

- A `Result<T, E>` discriminated union and the minimum helpers needed for
  callers to construct and chain values (`ok`, `err`, `andThen`).
- A `PortweaveError` base class carrying a `PW`-prefixed numeric code so
  errors can be dispatched on across module boundaries with reliable
  `instanceof` semantics under transpilation.
- An initial seed of `PW` error-code constants covering the failure modes
  Features 2–5 already need to express (registry locked, registry corrupt,
  config missing, config invalid, allocation exhausted).
- Tests that lock in the public shape and the cross-module `instanceof`
  guarantee.

**Out of scope (v0):**

- A full taxonomy of every error Portweave might ever emit. New codes are
  added as features that need them land.
- Logging policy, observability wiring, or structured-error serialization —
  those are downstream concerns built on top of this primitive.
- Async-Result helpers, combinators beyond `andThen`, or pipe/flow ergonomics.
  Add them when a caller actually needs them.
- A Rust-style `unwrap`/`expect` API. Portweave callers narrow on `result.ok`
  explicitly per the error-handling contract.

## Acceptance criteria sketch

- A `Result<T, E>` value carries either a success payload or a typed error,
  and the discriminant makes the union narrowable in TypeScript without
  casts.
- Constructing successes and failures, and chaining a fallible step onto a
  prior `Result`, work as described in the error-handling contract.
- A `PortweaveError` instance reports a stable `PW####` code and survives
  `instanceof PortweaveError` checks when thrown from one module and caught
  in another (the transpilation-safety invariant from the error-handling
  contract).
- The `PW` namespace ships with at least the five seed codes the next wave of
  features needs to reference: registry locked, registry corrupt, config
  missing, config invalid, allocation exhausted.
- Consumers that only need the _type_ of `Result` (not the runtime helpers)
  can import it as a type-only import without pulling runtime code along.

## Open questions

- Number range allocation for PW codes (start at PW0001? group by component?).
