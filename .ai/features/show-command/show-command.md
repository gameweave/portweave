---
name: show-command
title: portweave show introspection
roadmap_ref: .ai/roadmaps/v0-roadmap.md#8-show-command--portweave-show-introspection
status: scoped
---

# portweave show introspection

## Why

Once Portweave has allocated a block of ports to a worktree, developers need a
way to _ask_ what they got — without spawning a dev server, without restarting
anything, and without grepping the registry by hand. The motivating moments
are mundane and frequent: a teammate asks "what URL is your API on?" and you
need an answer in one command; a service hangs and you want to confirm the
allocation it's bound to before debugging further; a script in another
terminal wants to hit the same `api` port the running dev server claimed.

Without an introspection command, the only ways to recover that information
are reading `.portweave/current.env` (only present if a `portweave run`
already executed in this shell session's recent history), opening the
machine-wide registry JSON manually, or re-running `portweave run` and
re-reading the banner — which is wasteful and may not even be safe if a
process is already bound to those ports. `portweave show` makes the
allocation a first-class queryable value: read-only, side-effect-free, and
identical in shape to what `portweave run` would print, so the user's mental
model of "the allocation" is the same artifact regardless of how they look at
it.

The `--json` mode further unlocks scripting use cases: shell wrappers, agent
verification loops, and CI helpers can pipe `portweave show --json` into
`jq` or any structured-data tool and pull out exactly the port or namespace
they need, without parsing human-readable banner output.

## Parity rows

Adjacent to DESIGN.md §7.2 row #12 (the `portweave run` wrapper). Boardflip
does not surface an analogous introspection subcommand — its only way to see
an allocation is to run the dev wrapper or read the registry directly. This
feature realizes DESIGN.md §5.2's explicit promise that "a `portweave show`
subcommand prints the current allocation for the cwd's worktree without
running anything," covering use case #5 in §2 ("Developer wants to know
'what port is the API on right now in this worktree?'").

## Dependencies

- [config-loader](../config-loader/config-loader.md) — provides the
  normalized service inventory so the banner can label each allocated port
  with its declared service name and env-var, and so the `--json` payload
  can describe the namespace + service shape coherently. Without the config,
  there's no way to render the allocation in the same form `portweave run`
  prints.
- [worktree-context](../worktree-context/worktree-context.md) — resolves
  the current cwd to a stable `AllocationKey` (git common dir + worktree
  root + namespace). This is the lookup key the registry is queried under
  and the worktree path / namespace surfaced in the `--json` output.
- [registry-storage](../registry-storage/registry-storage.md) — supplies
  the read-only lookup primitive that finds the existing entry for the
  computed key. `show` is a pure reader: it never claims, never prunes,
  never mutates. The `lastUsedAt` bump that the storage layer applies on
  every lookup is acceptable observable behavior (it's a recency signal,
  not a logical mutation of the allocation).
- [env-resolution](../env-resolution/env-resolution.md) — formats the
  allocation + config into the same env-var map and banner the wrapper
  prints, so `portweave show` and `portweave run` produce structurally
  identical views of the same allocation rather than two divergent
  representations.

## Boardflip reference

None — introspection is Portweave-specific; boardflip surfaces this only
via direct registry inspection.

## Scope

**In scope (v0):**

- A `portweave show` subcommand that, from any cwd, resolves the current
  worktree, looks up the existing allocation in the registry, and prints
  the same human-readable banner the `portweave run` command would emit
  for that allocation.
- A strict no-mutation contract on the registry beyond whatever
  `lastUsedAt`-style recency bump the storage layer applies on lookup. The
  command never claims new ports, never prunes other entries explicitly,
  never rewrites the registry's allocation shape.
- A "no allocation yet" failure path: when the worktree has no entry in
  the registry, the command exits non-zero with a clear, actionable
  message instructing the user to run `portweave run` first. The failure
  surfaces as a typed `PW`-prefixed error rather than an unhandled throw.
- A `--json` flag that swaps the human banner for machine-readable JSON
  on stdout. The payload includes at minimum: the allocation key, the
  per-service port map, the resolved env-var map (the same one the
  wrapper would inject), the namespace, and the worktree path. Stderr
  stays human-readable for diagnostics.
- Consistent exit codes: `0` when an allocation is found and printed,
  non-zero on lookup miss or on any upstream error from config, worktree
  context, or registry storage.

**Out of scope (v0):**

- Filtering the output to a single service or env var (e.g. `portweave show
api`, `portweave show --port api`). The whole allocation is printed; any
  filtering downstream is the user's job via `jq` on `--json` output.
- Cross-worktree or whole-machine introspection (`portweave list`-style
  views of every project on the machine). That's a separate command in the
  future roadmap.
- Watching the registry and re-rendering on change — `show` is a one-shot
  read, consistent with the no-daemon design in DESIGN.md §5.6.
- Auto-allocating on first invocation when no entry exists. `show` is
  intentionally inert: if you want an allocation, run `portweave run`. The
  separation keeps the read-only guarantee honest.
- Alternate output formats beyond human + JSON (no YAML, no dotenv-style
  output — for dotenv, users read `.portweave/current.env` directly).

## Acceptance criteria sketch

- After a `portweave run` has produced an allocation for the current
  worktree, `portweave show` from anywhere inside that worktree prints
  the same allocation banner, with every service listed against its
  env-var name and allocated port, and exits zero. A second `portweave
show` immediately after produces byte-identical (or recency-only
  differing) output and leaves the registry's allocation entries
  unchanged.
- `portweave show` invoked in a worktree that has never had an
  allocation claimed exits non-zero with a typed `PW`-prefixed error
  whose message clearly instructs the user to run `portweave run`
  first. No partial output, no JSON payload, no claim is performed as
  a side effect.
- `portweave show --json` emits a single JSON document on stdout that
  parses cleanly via `JSON.parse` and contains at minimum the
  per-service port map, the namespace, and the worktree path. The same
  payload populated against the DESIGN.md Appendix B sample
  allocation round-trips through parse → re-stringify → parse without
  losing fields.
- The command exits non-zero on any upstream failure (registry locked,
  registry corrupt, not a recognizable directory) with the same typed
  error surface other Portweave commands use, so shell scripts can
  branch on exit code without parsing stderr.
- Running `portweave show` does not produce a `.portweave/current.env`
  side effect — that file is the responsibility of `portweave run`
  per DESIGN.md §5.2, and `show` must stay strictly read-only.

## Open questions

None significant from the roadmap.
