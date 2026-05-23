---
name: config-loader
title: Config loader and anonymous mode
roadmap_ref: .ai/roadmaps/v0-roadmap.md#2-config-loader--portweaveconfigjson-schema--zero-config-anonymous-mode
status: scoped
---

# Config loader and anonymous mode

## Why

Every downstream slice of Portweave — the allocator, env-var injection,
service-discovery URL construction, the `portweave run` wrapper, `portweave
show` — needs to know one thing first: _which services does this project
have, and what are they called?_ Without a normalized, validated service
inventory, none of those features can function. This feature is the doorway
into the rest of v0.

It also carries the lowest-friction onboarding story: a user who just wants
"three free ports for a one-off script" shouldn't have to author a config
file at all. Zero-config anonymous mode (`portweave run --count N -- ...`)
lets a brand-new user try Portweave with literally one CLI flag and no
setup, while projects with declared services get the richer named-service
experience without a separate code path downstream.

## Parity rows

DESIGN.md §7.2 row #5 (env-var injection for named services is _driven by
config_) and row #6 (per-service `urlTemplate` for discovery URLs like
`WEBSOCKET_ENDPOINT`) both depend on this feature for their input. Row #10
(multi-port services / Kinesis-style pairs allocating together) needs the
`group` key to be a first-class field of the normalized config so the
allocator can honor it.

## Dependencies

- [result-types](../result-types/result-types.md) — the loader returns a
  `Result<Config, ConfigError>` and uses the `PW` error-code namespace for
  the failure variants (config missing, config invalid).

## Boardflip reference

- [reference/boardflip/packages/shared/src/worktree-ports.ts](../../../reference/boardflip/packages/shared/src/worktree-ports.ts) —
  defines the 8-service shape (api, app/vite, authApi, dynamodb,
  dynamodbAdmin, kinesis, kinesisTls, ses, ws) that Portweave's config
  schema must be expressive enough to describe, including the
  Kinesis-plain-and-TLS pairing that motivates the `group` key. Boardflip
  hardcodes these services in TypeScript; Portweave lifts them into
  user-authored declarative config so the same shape can describe _any_
  project, not just boardflip.

## Scope

**In scope (v0):**

- A declarative schema for `portweave.config.json` covering: named
  services, each service's environment-variable name, an optional preferred
  port hint, an optional group label, and an optional map of discovery-URL
  templates referencing other services by name.
- Schema validation that produces a normalized, fully-typed config value or
  a typed error — never an uncaught throw on malformed input.
- A loader entry point that, given a working directory and options, finds
  and parses the config file and returns a `Result`-shaped value the rest
  of the system can consume.
- Anonymous mode: when no config file is present and the caller supplies a
  service count, synthesize an in-memory config of the same shape with
  generically-named services so downstream code can treat the file-loaded
  and zero-config cases identically.
- Preservation of `discoveryEnv` URL templates as raw strings with
  unresolved placeholders — template resolution against allocated port
  numbers belongs to a later feature.

**Out of scope (v0):**

- Resolving `${serviceName}` placeholders to concrete URLs (that happens
  after allocation, in the env-resolution feature).
- Framework auto-detection that synthesizes a config from `package.json`
  contents (DESIGN.md §6.1 option (b) — explicitly deferred).
- Alternate config sources beyond `portweave.config.json` (no
  `.portweaverc`, no `package.json#portweave`, no YAML/TOML at v0).
- Honoring the `preferred` field as an allocation hint at runtime — see
  open questions; the field is normalized but its semantics stay deferred.
- A config-init or scaffold command — that lands when (and if) the
  framework adapter story does.

## Acceptance criteria sketch

- The sample config in DESIGN.md Appendix A loads cleanly and surfaces all
  eight services with their env-var names, preferred ports, groups, and
  discovery templates intact.
- A missing config file, a malformed JSON file, or a config that fails
  schema validation produces a typed, human-readable error result rather
  than an uncaught exception, and the error identifies which field is at
  fault.
- Anonymous mode produces a normalized config that is structurally
  interchangeable with a file-loaded one: downstream consumers
  (allocator, env injector) cannot tell the two apart from shape alone.
- The `group` field, when present, survives normalization so the allocator
  can recognize which services must be allocated as a unit.
- Discovery-URL templates round-trip through the loader with their
  `${serviceName}` placeholders unresolved and unmangled, ready for a
  later resolution pass.
- A project that runs `portweave run --count 3 -- <cmd>` with no
  `portweave.config.json` on disk gets a usable config and proceeds to
  allocation; no config-missing error surfaces in that path.

## Open questions

- Should `preferred` carry through to allocator as a hint (recorded for v1
  hybrid mode) or be ignored at v0? DESIGN.md §5.1 says machine-wide pool
  gives "some" port — likely **ignore at v0** but normalize so the field
  survives the round-trip.
- File-name discovery — only `portweave.config.json`, or also
  `.portweaverc.json` / `package.json#portweave`? Recommend
  `portweave.config.json` only at v0.
