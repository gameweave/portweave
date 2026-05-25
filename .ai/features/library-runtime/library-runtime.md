---
name: library-runtime
title: portweave/runtime library API
roadmap_ref: .ai/roadmaps/v0-roadmap.md#9-library-runtime--import--ports--from-portweaveruntime-js-api
status: shipped
---

# portweave/runtime library API

## Why

Vite, Next, and Vitest config files evaluate before any `portweave run`
wrapper child can inject env vars or write `.portweave/current.env`. Without
an in-process API, those config-time consumers have no way to see the
allocation that should govern their behavior — even though Portweave knows
exactly which ports the project should use.

Pulling DESIGN.md §6.4 into v0 closes that gap: a JS project can `import`
from `portweave/runtime` directly inside its config file and get a
conflict-free allocation at the moment the config is evaluated, with no
wrapper-process gymnastics. This is the "user installs portweave in a fresh
Vite project and it just works" story DESIGN.md §6.4 calls out as load-
bearing, and it overturns decision-log row #6, which deferred the library
API to post-v0.

## Parity rows

DESIGN.md §6.4 — JS-library API timing. This feature resolves the open
question in §6.4 by pulling the library forward into v0. No row in
DESIGN.md §7.2 corresponds directly; the library is a second consumer of
the same allocation pipeline that backs `portweave run`, not a separate
parity row.

## Dependencies

- [config-loader](../config-loader/config-loader.md) — supplies the
  normalized service inventory the runtime needs to know which services
  exist and what their env-var names are.
- [worktree-context](../worktree-context/worktree-context.md) — resolves
  the current cwd to a stable worktree identity so the library returns
  the same allocation a sibling `portweave run` invocation would.
- [registry-storage](../registry-storage/registry-storage.md) — the
  file-locked machine-wide registry the runtime reads from and writes to,
  serialized through the same lock the CLI uses.
- [port-allocator](../port-allocator/port-allocator.md) — the lazy-claim
  code path the runtime reuses when no allocation exists yet for the
  current worktree, so in-process and CLI callers produce identical
  allocations.
- [env-resolution](../env-resolution/env-resolution.md) — turns the
  allocation into the env-var map the runtime exposes via `env()` and
  performs the `.portweave/current.env` side-effect write that keeps
  library and CLI consumers in lockstep.

## Boardflip reference

None directly — conceptually mirrors how
`reference/boardflip/scripts/src/utils/apply-worktree-env.ts` could be
called in-process rather than via a wrapper child. Boardflip never built
this; Portweave does.

## Scope

**In scope (v0):**

- A `portweave/runtime` subpath export that returns the allocation for the
  current cwd. If no allocation exists, the runtime allocates lazily using
  the same code path as `portweave run` and writes
  `.portweave/current.env` as a side effect.
- Minimal v0 API surface: `ports()` returning a `{ [serviceName]: number }`
  map, `env()` returning the resolved env-var map as
  `Record<string, string>`, and `allocation()` returning the full
  `Allocation` object.
- `package.json` `exports` field updated to expose `./runtime` so
  `import { ports } from 'portweave/runtime'` resolves under both ESM
  consumers and TypeScript projects.
- Two simultaneous in-process callers serialize through the same registry
  lock as the CLI — concurrent library use cannot corrupt the registry or
  produce divergent allocations.

**Out of scope (v0):**

- Watching the registry or config and re-emitting on changes — the API is
  one-shot per call.
- Subscribing to allocation events from other processes.
- A separate non-`/runtime` library entry; the programmatic surface lives
  only at the `./runtime` subpath at v0.
- Framework adapters (Vite plugin, Next plugin) — those are post-v0.

## Acceptance criteria sketch

- `import { ports } from 'portweave/runtime'` resolves under both ESM and
  TypeScript projects, verified via a smoke test that builds a tiny
  consumer against the published `exports` field.
- Calling `ports()` from a Vite config file at config-eval time returns a
  valid block of allocated ports and writes `.portweave/current.env` as a
  side effect — the wrapper child is not required to be present.
- Two simultaneous in-process callers (rare but possible) serialize
  through the same registry lock as the CLI and observe a single
  consistent allocation rather than two competing claims.

## Open questions

- Should the library be sync (simple) or async? Vite config can be async;
  recommend **async** (`await ports()`) — Node fs locking is async anyway.
- Append a dated note to [.ai/decision-log.md](../../decision-log.md)
  overturning row #6. _(Task for the spec phase — not a question to
  resolve here.)_
