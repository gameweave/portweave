---
name: env-resolution
title: Env-var resolution and .portweave/current.env writer
roadmap_ref: .ai/roadmaps/v0-roadmap.md#6-env-resolution--env-var-computation-url-template-expansion-portweavecurrentenv-writer
status: drafted
---

# Env-var resolution and .portweave/current.env writer

## Why

Allocating ports is only half the value. For the allocation to matter, those
port numbers have to flow into the user's dev process automatically — both as
environment variables on the child process and as a `.env`-style file other
tools can read. This feature is what turns a port allocation into something
the rest of the dev stack actually consumes.

It also realizes DESIGN.md §5.2's "two consumption modes from one code path"
promise: the wrapper child gets env vars injected directly, _and_
`.portweave/current.env` is written every run so Docker Compose, IDE run
configs, Vite/Next config files that load before any wrapper child, and
`cat`-based introspection all see the same allocation. Without this feature,
allocation is invisible outside the immediate `portweave run` subprocess and
the second consumption mode doesn't exist.

Finally, this is the place where service-discovery URLs get materialized.
Boardflip's parity story leans on constructed env vars like
`WEBSOCKET_ENDPOINT = ws://localhost:${ws}` and `VITE_API_URL = http://localhost:${api}`
— users get these for free once they declare `discoveryEnv` templates in
their config.

## Parity rows

DESIGN.md §7.2:

- **Row 5** — env-var injection for named services (each service's
  `envVar` gets the allocated port).
- **Row 6** — service-discovery URL construction via per-service
  `urlTemplate` / `discoveryEnv` entries with `${serviceName}`
  placeholders.
- **Row 9** — `.env` seeding with user-override priority: existing `.env`
  values win over computed ones; computed values seed unset keys.

This also realizes DESIGN.md §5.2's always-write `.portweave/current.env`
side effect.

## Dependencies

- [config-loader](../config-loader/config-loader.md) — supplies the
  normalized service inventory with per-service `envVar` names and the raw
  `discoveryEnv` URL templates (with `${serviceName}` placeholders still
  unresolved). Env resolution is the consumer that finally turns those
  templates into concrete URL strings.
- [port-allocator](../port-allocator/port-allocator.md) — supplies the
  `Allocation` (per-service port map) that env resolution pairs with the
  config to produce the env-var map. Without an allocation there are no
  port numbers to substitute.

## Boardflip reference

- [reference/boardflip/scripts/src/utils/apply-worktree-env.ts](../../../reference/boardflip/scripts/src/utils/apply-worktree-env.ts)
  — inspires both halves of the v0 surface: the `setIfUnset`-style env
  injection that lets existing process env (and seeded `.env` values) win
  over computed defaults, and the URL-construction pattern
  (`http://localhost:${port}`, `ws://localhost:${port}`) that Portweave
  generalizes into per-service `discoveryEnv` templates. Boardflip
  hardcodes the service names and URL shapes; Portweave lifts both into
  declarative config so the same pattern serves any project.
- [reference/boardflip/scripts/src/utils/e2e-port-env.ts](../../../reference/boardflip/scripts/src/utils/e2e-port-env.ts)
  — inspires the additional URL vars surfaced specifically for E2E
  consumers (`VITE_API_URL`, `VITE_WS_URL`, `E2E_API_ORIGIN`). In
  Portweave these aren't a separate code path; they're just additional
  entries in a service's `discoveryEnv` map, computed by the same
  template-evaluation pass.

## Scope

**In scope (v0):**

- Build the env-var map from an `Allocation` plus a `Config`: one entry
  per service (`config.services[name].envVar -> allocation.ports[name]`)
  plus every resolved entry from each service's `discoveryEnv` map.
- Template evaluation for `discoveryEnv` values: each `${serviceName}`
  placeholder substitutes the allocated port for that service. Multiple
  placeholders per template are supported (e.g.
  `http://localhost:${api}/from/${ws}`).
- `.env` seeding priority (§7.2 row 9): any key already present in the
  project root's `.env` wins over the computed value. Computed values
  only seed keys that are unset. Existing process env wins over both.
- Always-write `.portweave/current.env`: every run atomically writes the
  full computed env map to `.portweave/current.env` at the project root,
  in human-readable dotenv format. Atomic means no partial-write window
  is observable to readers.
- Auto-create the parent `.portweave/` directory if missing, so first
  runs in a fresh project succeed without manual setup.

**Out of scope (v0):**

- Templating beyond simple `${serviceName}` substitution (no
  expressions, no conditionals, no fallbacks).
- Watching `.env` for changes and re-resolving — env resolution is a
  one-shot operation per allocation.
- Writing anywhere other than `.portweave/current.env` at the project
  root (no per-worktree alternates, no XDG location).
- Surfacing URL strings to consumers other than as env vars (no
  programmatic API at v0; library API is deferred per DESIGN.md §6.4).
- Cleaning up stale `.portweave/current.env` files when an allocation
  is released or pruned — those are forensics concerns for a later
  command.

## Acceptance criteria sketch

- The sample config in DESIGN.md Appendix A, paired with a realistic
  allocation, produces exactly the env vars shown in DESIGN.md
  Appendix B.
- Multi-placeholder URL templates resolve correctly — every
  `${serviceName}` is substituted with the right allocated port, and
  templates referencing two or more services produce the expected
  fully-resolved string.
- Existing `.env` keys win over computed values: a project that
  hardcodes `API_PORT=4000` in its root `.env` keeps `API_PORT=4000`
  after env resolution, even when the allocation assigned a different
  port to the `api` service. Keys _not_ present in `.env` get the
  computed values.
- `.portweave/current.env` is written atomically — no observable
  partial-write state — and the file content is valid, human-readable
  dotenv format.
- A first run in a project without an existing `.portweave/` directory
  succeeds: the directory is auto-created and `current.env` lands
  inside it.

## Open questions

- `.portweave/.gitignore` — auto-create with `*` entry to keep the dir
  gitignored at the project level? Recommend **yes**, matches
  CLAUDE.md's "Runtime state is gitignored" guidance.
