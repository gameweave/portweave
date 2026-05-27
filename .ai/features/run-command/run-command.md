---
name: run-command
title: portweave run CLI wrapper
roadmap_ref: .ai/roadmaps/v0-roadmap.md#7-run-command--cli-skeleton--portweave-run-----cmd
status: shipped
---

# portweave run CLI wrapper

## Why

`portweave run -- <cmd>` is the primary user-facing entry point for
Portweave. Every other v0 feature — config loading, worktree detection,
port allocation, env resolution — exists so that this single command can
deliver on the zero-thought promise: a developer (or coding agent)
substitutes `portweave run -- npm start` for `npm start` and gets
allocated ports plus env vars wired into their existing workflow with no
further configuration.

This is also where the "two consumption modes from one code path"
contract from DESIGN.md §5.2 becomes visible to users: the wrapper
injects the computed env into the spawned child _and_ the same run
writes `.portweave/current.env` as a side effect, so Docker Compose, IDE
run configs, Vite/Next config files that read env at load time, and a
quick `cat .portweave/current.env` for "what port is the API on right
now?" all see the same allocation without any extra wiring.

Finally, the allocation summary banner from DESIGN.md Appendix B lands
here. The banner is how a developer confirms at a glance which ports the
run picked up, which worktree namespace it resolved to, and that the
side-effect env file was written — turning what would otherwise be an
opaque env-injection layer into something inspectable in the terminal
the developer was already watching.

## Parity rows

DESIGN.md §7.2 row **#12** — _Wrapper CLI entry point_ — Gameweave's
`scripts/bin/dev.ts` is the per-project version of exactly this; the
`portweave run` wrapper is the language-agnostic, project-agnostic
generalization.

The run command is also load-bearing for §5.2 (wrapper CLI primary,
`.env` side effect always written) and Appendix B (the
`[portweave]` allocation banner shape).

## Dependencies

- [config-loader](../config-loader/config-loader.md) — supplies the
  normalized service inventory (or the anonymous-mode synthesized
  equivalent when `--count` is used), which the run command feeds into
  every downstream step.
- [worktree-context](../worktree-context/worktree-context.md) —
  supplies the `AllocationKey` for the cwd so the run command knows
  which worktree's allocation to look up or create, and resolves the
  namespace surfaced in the banner.
- [port-allocator](../port-allocator/port-allocator.md) — produces the
  `Allocation` (per-service port map) the run command then injects and
  prints. The wrapper has no opinion about which ports get picked; it
  just consumes the allocator's result.
- [env-resolution](../env-resolution/env-resolution.md) — turns the
  config + allocation into the env-var map injected into the child and
  written to `.portweave/current.env`. The run command is the consumer
  that finally hands that env to a child process and propagates exit
  status back out.

## Gameweave reference

- Gameweave's per-project dev wrapper (modeled on Gameweave's internal
  worktree-port system) inspires the _orchestration shape_ of the run
  command: resolve worktree context, compute ports, seed env from dotenv,
  apply env, print a human-readable startup summary, then `spawn` the child
  with `stdio: 'inherit'` and propagate the exit code. Gameweave hardwires
  PM2 as the child and the Gameweave-specific service list into the
  banner; Portweave generalizes both so any command becomes the child
  and the banner is driven by whatever services the config (or
  anonymous mode) declared. Gameweave's signal handling is implicit
  (it relies on `stdio: inherit` and the child crashing on its own);
  Portweave makes SIGINT/SIGTERM forwarding explicit per the
  acceptance criteria below.

## Scope

**In scope (v0):**

- A `portweave run -- <cmd> [args...]` subcommand that takes everything
  after the `--` separator as the child command and its arguments.
- End-to-end orchestration for a single run: resolve the worktree
  context for the cwd → load the config (or synthesize one in anonymous
  mode) → allocate ports → compute the env map → write
  `.portweave/current.env` → spawn the child with the merged env,
  inheriting stdio.
- Print the `[portweave]` allocation summary banner matching
  DESIGN.md Appendix B — worktree + namespace line, per-service port
  rows, the `wrote .portweave/current.env` line, and the
  `launching: <cmd>` line.
- Signal forwarding: SIGINT and SIGTERM received by the wrapper
  propagate to the child process cleanly so Ctrl-C in the developer's
  terminal stops the child the way it would without the wrapper in
  between.
- Exit-status propagation: the wrapper's exit code matches the child's
  exit code, so CI scripts, npm scripts, and shells observing the
  wrapper see the same success/failure signal they would from running
  the child directly.
- Global flags wired into the CLI root: `--config <path>` to point at a
  non-default config location, `--count <n>` to enable the
  config-loader's anonymous mode without a config file on disk, and
  `--verbose` for additional diagnostic output.
- Commander wired in at the CLI root so the subcommand surface is
  ready for future siblings (`portweave show`, etc.) without rework.

**Out of scope (v0):**

- Any subcommand other than `run` and whatever minimum scaffolding
  Commander needs at the root (help/version). `portweave show`,
  `portweave list`, `portweave release` etc. are separate features.
- A non-spawn execution mode (eval-in-process, library API). The
  library API is deferred per DESIGN.md §6.4.
- Restart/watch/respawn behavior. The wrapper is a one-shot: it spawns
  once, forwards exit status once.
- PM2-style multi-process orchestration. Gameweave's `dev.ts` happens
  to spawn PM2; `portweave run` does not embed a process manager.
  Users who want one wrap _it_ with `portweave run -- pm2 start ...`.
- A `--dry-run` mode that prints the banner and env without spawning.
  Useful but deferred.
- TTL/auto-release behavior — the run command does not release the
  allocation on exit. Pruning lives in the registry layer.

## Acceptance criteria sketch

- Running `portweave run -- node -e 'console.log(process.env.API_PORT)'`
  in a project whose config declares an `api` service prints the
  allocated port for that service, demonstrating the env injection
  reached the child process.
- The child process receives every env var the env-resolution feature
  computed for the allocation, merged with the parent process's env
  (parent-env priority follows the env-resolution feature's contract).
- A SIGINT or SIGTERM received by the running `portweave run`
  invocation reaches the child process so Ctrl-C in the terminal stops
  the dev stack the way it would without the wrapper.
- The wrapper's exit code equals the child's exit code: a child that
  exits 0 produces `portweave run` exiting 0; a child that exits 1 (or
  any other status) produces the same status from `portweave run`.
- The on-stream banner output matches the shape in DESIGN.md Appendix
  B: a worktree/namespace header, an `allocated:` block listing each
  service → port (env-var name), a `wrote .portweave/current.env`
  acknowledgement line, and a `launching: <cmd>` line, all prefixed
  with `[portweave]`.
- `portweave run --count 3 -- <cmd>` succeeds in a directory with no
  `portweave.config.json` on disk — anonymous mode reaches the
  allocator and the child sees the generically-named env vars without
  any config-missing error.
- `portweave run --config ./alt.config.json -- <cmd>` loads the named
  file instead of the default discovery path, so projects that keep
  multiple configs (e.g. one per environment) can select between them.
- `portweave run --verbose -- <cmd>` prints additional diagnostic
  output beyond the standard banner without changing the success
  path's observable contract.

## Open questions

- Stderr vs stdout for the `[portweave]` banner — banner goes to stderr
  so it doesn't pollute child stdout pipelines. Recommend **stderr**.
