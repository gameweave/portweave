---
name: metadata-injection
title: Portweave metadata injection — PORTWEAVE_NAMESPACE baseline + ${pw:*} templating
roadmap_ref: .ai/roadmaps/v0-roadmap.md#6-env-resolution--env-var-computation-url-template-expansion-portweavecurrentenv-writer
status: shipped # drafted | scoped | shipped | abandoned
---

# Portweave metadata injection

## Why

Portweave already computes a stable per-worktree identity — the namespace
(`main` for the primary worktree, `<slug>-<hash>` for others) — and uses it to
key allocations. That identity is exactly what downstream tooling needs to keep
worktrees from colliding in shared, single-instance daemons: the canonical case
is PM2, where every worktree running `npm run dev` registers into one machine-wide
process table keyed by name, so two worktrees both register a process literally
named `gameweave-api` and clobber each other. Distinct ports don't fix that —
process-name uniqueness is orthogonal to port uniqueness.

Portweave deliberately does **not** manage processes, so it will never name PM2
apps itself. But it _can_ hand the consumer the one primitive that makes
per-worktree naming trivial: the namespace. DESIGN.md already promises this
(§7.2 row 4: namespace "exposed via `PORTWEAVE_NAMESPACE` for PM2/log consumers";
§7.3 step 5: "read process-name suffix from `PORTWEAVE_NAMESPACE`"). Today that
promise is unmet — the derived namespace is computed internally and read only as
an _input_ override; it is never surfaced back to the child process or
`.portweave/current.env`. A consumer running under `portweave run` sees
`PORTWEAVE_NAMESPACE` only if it set the value itself, which defeats the purpose.

This feature closes that gap and generalizes it. Beneficiaries: anyone wiring a
worktree-aware label into a tool that lives outside portweave's env-var surface —
PM2 process names, OpenTelemetry service names, log prefixes, container names,
test-suite tags. They get a predictable always-present baseline _and_ an escape
hatch to surface any portweave metadata under any env var name they choose,
without portweave having to anticipate each consumer's needs.

## Parity rows

DESIGN.md §7.2:

- **Row 4** — _Namespace derivation_. This feature delivers the "exposed via
  `PORTWEAVE_NAMESPACE` for PM2/log consumers" half of that row, which the
  worktree-context feature derives but does not yet surface.
- **Row 6** — _Service-discovery via templates_. The `${pw:*}` sigil extends the
  same `discoveryEnv` template mechanism this row established, so metadata and
  ports compose in one template grammar.

Also realizes the §5.2 "two consumption modes from one code path" contract for
metadata: whatever is exposed must reach both the injected child env and
`.portweave/current.env`.

## Dependencies

- [env-resolution](../env-resolution/env-resolution.md) — owns the `discoveryEnv`
  template grammar this feature extends and the env-map / `current.env` writer
  the baseline var flows through.
- [worktree-context](../worktree-context/worktree-context.md) — derives the
  namespace (and the worktree-root / git-common-dir context) being surfaced, and
  already honors `PORTWEAVE_NAMESPACE` as an input override.
- [run-command](../run-command/run-command.md) — the consumer that injects the
  resolved env into the child and reports it in the banner.

## Gameweave reference

Gameweave's internal worktree-port system hand-rolls the same namespace
derivation (basename + short hash, `main` for the primary worktree) and feeds it
into PM2 process names (`<service>-<namespace>`) and into e2e stack
detection/teardown (`pm2 delete /.*-<namespace>$/`). That prior art is the proof
that the namespace primitive — not portweave-owned process management — is what a
consumer actually needs. Once this feature ships, Gameweave can delete its own
namespace derivation and read `PORTWEAVE_NAMESPACE` instead, while keeping its
PM2 naming entirely on its side of the boundary.

## Scope

**In scope (v0):**

- An always-injected baseline env var `PORTWEAVE_NAMESPACE`, set to the resolved
  namespace for the current allocation, present on every `portweave run` with no
  configuration required. It sits at the computed-value precedence tier, so an
  explicit `.env` or parent-process value still wins.
- A reserved `${pw:<field>}` template sigil usable in `discoveryEnv` values
  alongside the existing `${serviceName}` port placeholders, so a consumer can
  surface metadata under any env var name and compose it into a string (e.g.
  `gw-${pw:namespace}`).
- A defined, closed set of metadata fields reachable through the sigil, mapping
  to the worktree allocation identity: `namespace`, `worktreeRoot`,
  `gitCommonDir`.
- Both surfaces honor the two-consumption-modes contract: the baseline var and
  any `${pw:*}`-derived entries appear in both the spawned child's env and
  `.portweave/current.env`.

**Out of scope (v0):**

- Any portweave-owned process management — naming, registering, or tearing down
  PM2 (or any other) processes. Portweave provides the identity primitive; the
  consumer applies it.
- Exposing block offset / base port as metadata. The per-project `base + offset`
  model was deliberately replaced by a machine-wide pool (DESIGN.md §5.1); a
  `${pw:offset}` placeholder would reintroduce a retired mental model and is
  redundant with the already-first-class per-service port env vars.
- Exposing run-state such as whether the allocation was reused vs. freshly
  created. That is ephemeral to a single run and would go stale inside the
  persisted `current.env` snapshot; it remains available via the library runtime
  and the `--verbose` banner.
- A general-purpose expression language in templates (conditionals, fallbacks,
  arithmetic). The sigil resolves a fixed field set, nothing more.
- A new top-level config block for declaring exposures — the existing
  `discoveryEnv` mechanism is the surface.

## Acceptance criteria sketch

- Running `portweave run -- <cmd>` in the primary worktree of a project makes
  `PORTWEAVE_NAMESPACE=main` observable to the child, with no config change; in a
  non-primary worktree the same command yields the `<slug>-<hash>` namespace.
- The same `PORTWEAVE_NAMESPACE` value appears in `.portweave/current.env` after
  the run, so a tool that `source`s the file sees the identical namespace the
  child process saw.
- A `discoveryEnv` entry like `"OTEL_SERVICE_NAME": "gw-${pw:namespace}"` produces
  the interpolated value in both the child env and `current.env`.
- `${pw:worktreeRoot}` resolves to the absolute worktree path; `${pw:gitCommonDir}`
  resolves to the shared git directory inside a repo and to an empty string when
  run outside any git repository (no crash).
- An unknown field placeholder (e.g. `${pw:bogus}`) fails the run with a clear
  error, mirroring the existing "unknown service" template behavior rather than
  silently emitting an empty or literal value.
- When the consumer sets `PORTWEAVE_NAMESPACE` explicitly in the environment, the
  child observes that value (override wins over the computed baseline), preserving
  the existing input-override contract.

## Open questions

- **Two-modes divergence for the baseline var.** `.portweave/current.env` is
  written from the computed env (the sanitized/derived namespace), while the child
  process env is the computed env merged under the parent process env, so a raw,
  unsanitized parent `PORTWEAVE_NAMESPACE` could win in the child while the file
  carries the sanitized slug. The spec must pick: (a) accept parent-wins and
  document the difference, or (b) normalize so both modes agree. Leaning (b) for
  this var specifically, since the namespace is meant to be a sanitized slug.
- **Sigil spelling.** `${pw:field}` is the working choice (reserves a prefix that
  cannot collide with a service literally named `namespace`). Confirm against
  `${pw.field}` / `${@field}` during the spec; the only hard requirement is
  collision-freedom with `${serviceName}`.
- **Field-name casing.** Expose fields as `worktreeRoot` / `gitCommonDir`
  (matching the internal key shape) or as `worktree-root` / `git-common-dir`
  (kebab, friendlier in a template)? Decide in the spec.
