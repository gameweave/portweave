---
name: parity-verification
title: Gameweave drop-in acceptance gate
roadmap_ref: .ai/roadmaps/v0-roadmap.md#10-parity-verification--gameweave-drop-in-adoption-acceptance-test
status: shipped
---

# Gameweave drop-in acceptance gate

## Why

v0 ships only if it can actually replace Gameweave's existing worktree-port
system without users noticing functional regressions. Every prior feature in
the v0 roadmap solves one slice of the problem — config loading, worktree
detection, registry coordination, allocation, env injection, the run wrapper,
introspection, the library API — but none of them, on their own, prove that
the integrated system behaves the way Gameweave's hand-rolled stack does today.

This feature is the single test gate that proves it. It exercises Portweave
end-to-end against a `portweave.config.json` that mirrors Gameweave's eight
services, simulates two parallel worktrees the way a developer (or coding
agent) actually uses them, and asserts that the observable contract matches
what Gameweave's worktree-env application emits today — including the
constructed discovery URLs that Gameweave's runtime depends on. It also ships
the migration documentation a Gameweave maintainer (or any future adopter)
follows to retire their hand-rolled system.

Without this feature, "v0 reaches parity" is a claim. With it, "v0 reaches
parity" is a green test.

## Parity rows

DESIGN.md §7.3 — _Drop-in adoption test (v0 verification criterion)_. This is
the gating test for v0 acceptance overall; it does not introduce a new row in
§7.2 but instead **verifies all 14 rows in §7.2 are satisfied by the
integrated system in concert**, not just individually in their respective
feature specs.

## Dependencies

This feature depends on every prior v0 feature — it is the integration
checkpoint that wires them together.

- [result-types](../result-types/result-types.md) — assertions over typed
  failure modes (e.g. `PORTWEAVE_OFFSET` invalid literal, pool exhaustion)
  need the shared `Result`/`PortweaveError` surface to inspect cleanly.
- [config-loader](../config-loader/config-loader.md) — the test authors a
  real `portweave.config.json` mirroring Gameweave's eight services with
  their env-var names, group labels, and `discoveryEnv` URL templates; the
  loader is what turns that file into the input every downstream feature
  consumes.
- [worktree-context](../worktree-context/worktree-context.md) — the
  two-worktree simulation needs real git worktree detection so the two
  simulated worktrees get distinct `AllocationKey`s and distinct namespaces,
  exercising the stickiness and disjoint-block contracts together.
- [registry-storage](../registry-storage/registry-storage.md) — concurrent
  allocations from the two simulated worktrees must serialize through the
  same machine-wide registry under directory-mutex locking; the test
  exercises that the storage layer is what keeps the two from colliding.
- [port-allocator](../port-allocator/port-allocator.md) — the
  no-overlap-across-worktrees, all-services-move-together, group-contiguity,
  and stickiness invariants live in the allocator; the parity test is where
  those invariants get verified against a realistic 8-service config under
  concurrent load.
- [env-resolution](../env-resolution/env-resolution.md) — the test compares
  the env-var map (and the resolved discovery URLs) Portweave produces
  against what Gameweave's worktree-env application would emit for the same
  port numbers; this feature is the place those URLs are materialized.
- [run-command](../run-command/run-command.md) — the simulation invokes
  `portweave run -- <noop>` to exercise the full end-to-end orchestration
  path a real Gameweave user would hit, not an in-process shortcut.
- [show-command](../show-command/show-command.md) — the test confirms the
  introspection surface returns the same allocation after the `run` step,
  proving the read path agrees with the write path. This is the inspection
  parity that Gameweave never had but Portweave's adopters get for free.
- [library-runtime](../library-runtime/library-runtime.md) — the in-process
  consumer must produce the same allocation as the CLI for the same
  worktree, exercising the §6.4 promise that config-time callers
  (Vite/Next/Vitest) see the same ports as the wrapper-spawned children.

## Gameweave reference

- Gameweave's worktree-env application (modeled on Gameweave's internal
  worktree-port system) is the env-var contract this test verifies parity
  with. It defines the complete set of env vars Gameweave seeds onto a
  worktree's child process (`API_PORT`, `VITE_API_PORT`, `WS_PORT`,
  `VITE_WS_PORT`, `VITE_PORT`, `AUTH_API_PORT`, `VITE_AUTH_PORT`,
  `DYNAMODB_PORT`, `DYNAMODB_ENDPOINT`, `KINESIS_PORT`, `KINESIS_TLS_PORT`,
  `KINESIS_ENDPOINT`, `SES_LOCAL_PORT`, `SES_ENDPOINT`,
  `WEBSOCKET_ENDPOINT`, `GAMEWEAVE_PM2_NAMESPACE`, `GAMEWEAVE_WORKTREE_OFFSET`)
  and the URL-construction shape (`http://localhost:${port}`) those
  endpoints take. Portweave's parity config recreates this shape via
  declarative `envVar` + `discoveryEnv` entries, and the parity test
  asserts that the resulting environment matches what Gameweave's
  worktree-env application would emit for the same port numbers — modulo the
  `GAMEWEAVE_*` → `PORTWEAVE_*` namespace rename captured in DESIGN.md
  §7.2 row 8.

## Scope

**In scope (v0):**

- Author a `portweave.config.json` (kept under `examples/`) that declares
  Gameweave's eight services — `api`, `ws`, `vite`, `dynamodb`,
  `dynamodb-admin`, `kinesis`, `kinesis-tls`, `ses` — with their env-var
  names, group labels for the Kinesis-plain + Kinesis-TLS and DynamoDB +
  DynamoDB-Admin pairings, and `discoveryEnv` URL templates matching the
  endpoints in Gameweave's worktree-env application.
- A root-level cross-cutting integration test at
  `__tests__/gameweave-parity.test.ts` that simulates a Gameweave-like
  environment: a real temp git repo with two worktrees, `portweave run --
<noop>` invoked in each, and assertions that verify the integrated v0
  system end-to-end. Test placement follows the root-`__tests__/` convention
  in [.claude/rules/testing.md](../../../.claude/rules/testing.md) for
  cross-cutting integration tests that don't belong to one module.
- Explicit assertions in the test suite covering each of the 14 rows in
  DESIGN.md §7.2 — the test is the auditable evidence that every parity
  row is satisfied by the integrated system, not just by its individual
  feature spec.
- A README section documenting the Gameweave migration steps following
  DESIGN.md §7.3 — deleting Gameweave's per-project allocation helpers,
  adding `portweave.config.json`, changing `scripts/bin/dev.ts` to invoke
  `portweave run` ahead of PM2, and updating the PM2 namespace source —
  written so a fresh reader can follow the procedure without external
  context.

**Out of scope (v0):**

- Running Gameweave's real end-to-end suite in CI against a live
  Portweave binary. See the open question below — recommended deferred for
  v0; the simulated test is the gate for now.
- Verifying Gameweave-specific runtime behaviors that live outside
  Portweave's contract (PM2 process naming, the e2e Playwright harness
  itself, dotenv handling beyond `.env` seeding priority). Those remain
  Gameweave's responsibility on its own side of the integration boundary.
- A general-purpose parity-test framework for other future adopters.
  Gameweave is the v0 reference consumer; if more adopters arrive, the
  test shape can be generalized then.
- Performance benchmarking, lock-contention stress beyond what
  registry-storage's spec already covers, or pool-saturation scenarios.

## Acceptance criteria sketch

- All 14 Gameweave parity items from DESIGN.md §7.2 are verified explicitly
  by at least one assertion in the test suite. Each row is identifiable
  in the test source (by row number or by descriptive name) so a reviewer
  can cross-reference the test against the §7.2 table without guesswork.
- Two simulated worktrees of the same repo, each invoking `portweave run --
<noop>`, both receive complete allocations for all eight services, and
  the two allocations share no ports. The simultaneous case (both runs
  in flight against the same registry) succeeds without lock contention
  errors and produces disjoint blocks.
- For each allocated block, the resolved env-var map and constructed
  discovery URLs match what Gameweave's worktree-env application (modeled on
  Gameweave's internal worktree-port system) would emit for the same port
  numbers — modulo the `GAMEWEAVE_*` → `PORTWEAVE_*` namespace rename from
  §7.2 row 8.
- Rerunning `portweave run -- <noop>` in the same simulated worktree
  produces byte-identical port allocations to the prior run — the
  stickiness contract from DESIGN.md §5.4 holds end-to-end across the
  integrated system.
- The migration documentation in the README is followable by a fresh
  reader against DESIGN.md §7.3 steps 1–6 without needing external
  context: someone who has never seen Portweave before can read the
  section and understand what to delete, what to add, and what to
  change in a Gameweave-style consumer.
- `npm run dev-workflow` runs green with this feature in place — the new
  config example, integration test, and README section all pass the full
  quality suite including duplication, complexity, dead-code, and
  structure checks.

## Open questions

- Should this also run Gameweave's real e2e suite in CI, or is the
  simulated test enough at v0? Recommend simulated only at v0 — real e2e
  adds a heavy CI dependency on Gameweave's repo state.
