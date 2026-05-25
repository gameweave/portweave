# Portweave

> Zero-thought, conflict-free local-dev port allocation across projects and git worktrees.

**Status:** Pre-v0 — scaffolding complete, implementation in progress.

Portweave is an OSS utility from the [Gameweave](https://github.com/gameweave) organization. The full design rationale lives in [.ai/DESIGN.md](.ai/DESIGN.md); the short version follows.

## The problem

When you run multiple projects on one machine — or multiple git worktrees of the same project, or multiple AI coding agents in parallel worktrees — every dev server, database, and test runner wants its own ports. Today, developers solve this by hand: `.env.local` files, hardcoded offsets, per-worktree conventions. Each project reinvents the wheel.

## What Portweave does

```bash
$ portweave run -- pnpm dev
[portweave] worktree: boardflip-feature-x (namespace: feature-x-7a2b91)
[portweave] allocated:
  api               → 3104     (API_PORT)
  ws                → 3105     (WS_PORT)
  vite              → 5178     (VITE_PORT)
[portweave] wrote .portweave/current.env
[portweave] launching: pnpm dev
```

Run once, get a unique block of ports for _this worktree_. Re-run from the same worktree, get the same ports back (sticky). Spin up another worktree, get a different block automatically. Spin up an unrelated project, also no collision — Portweave's registry is machine-wide.

## How it works

- **Single config file** (`portweave.config.json`) declares your project's services with their env-var names.
- **Per-worktree allocation** keyed on `(git common-dir, worktree path)` — same worktree always gets the same ports.
- **Machine-wide pool** at `~/.config/portweave/registry.json` — no two simultaneously-running projects collide.
- **Live conflict detection** — Portweave probes each port before claiming it, re-rolling if something external (Postgres, etc.) already has it.
- **Two consumption modes**: wrapper CLI (`portweave run -- <cmd>`) injects env vars; the same code path writes `.portweave/current.env` for tools that don't inherit (Docker Compose, IDEs, Vite config files).

For the full design (including the §6 open discussion topics and §7 boardflip-parity checklist), see [.ai/DESIGN.md](.ai/DESIGN.md).

## Development

### Setup

```bash
nvm use            # Node 24+
npm install
```

Some checks require external tools:

- **similarity-ts** (Rust-based code similarity): `cargo install similarity-ts` (skipped if absent)

### Daily workflow

```bash
npm run dev-workflow         # Full quality suite (run before pushing)
npm run dev-workflow -- --quick   # Skip test/upgrade/similarity for fast iteration
npm test                     # Just tests
npm run lint:fix             # Auto-fix lint
npm run format               # Auto-format
```

The pre-commit hook runs the fast subset (`format:check`, `lint`, `typecheck`). The full suite runs in CI.

### Repo layout

- `src/` — Library + CLI source
- `scripts/` — Devtools (bin/, src/utils/, src/tasks/)
- `config/eslint/` — Modular ESLint rule configs
- `.ai/` — Design docs, decision log, specs ([read first](.ai/README.md))
- `.claude/` — AI agent rules and skills
- `reference/boardflip/` — Read-only snapshot of boardflip's worktree-port system (the design inspiration)

See [.claude/rules/project-structure.md](.claude/rules/project-structure.md) for the full convention.

## Migrating from a hand-rolled worktree-port system (boardflip)

If you are coming from boardflip's internal `worktree-ports` system (or any project that hard-codes a `base + offset * 100` convention), migrating to Portweave is a single PR:

1. **Delete the bespoke helpers.** Remove `scripts/src/utils/worktree-context-*.ts`, `packages/shared/src/worktree-ports.ts`, and any related shared utilities. Portweave replaces all of that logic.

2. **Add `portweave.config.json`** to your project root declaring each service's env-var name, optional grouping, and URL templates. See [`examples/boardflip.config.json`](examples/boardflip.config.json) for a drop-in template that covers boardflip's 8-service layout (api, ws, vite, dynamodb, dynamodb-admin, kinesis, kinesis-tls, ses), including `discoveryEnv` URL templates like `VITE_API_URL`, `DYNAMODB_ENDPOINT`, and `KINESIS_ENDPOINT`.

3. **Wrap your startup script.** In `scripts/bin/dev.ts` (or equivalent), invoke `portweave run -- <your-command>` instead of calling the old worktree-port helpers directly. Portweave injects all configured env vars into the child process automatically.

4. **Update PM2 / orchestrator config.** If you use PM2 or another process manager, read the process-name suffix from `PORTWEAVE_NAMESPACE` (set by Portweave) instead of from the internal helpers you just deleted.

5. **Source `.portweave/current.env` for tools that don't inherit env.** Docker Compose, IDEs, and `vite.config.ts` files that read port config at startup need this file. Portweave writes it automatically on every `portweave run` invocation — add it to your `.gitignore` and instruct those tools to source it.

6. **Verify.** Run your e2e suite from both `main` and a feature worktree simultaneously. Portweave's sticky per-worktree allocation means each gets its own non-colliding port block, so both suites should pass with no manual intervention.

Acceptance criterion (from [.ai/DESIGN.md §7.3](.ai/DESIGN.md)): all e2e tests pass; worktree behavior is identical from a user's POV; the e2e suite runs green in both `main` and at least one feature worktree simultaneously.

## Contributing

We're early. The current state is scaffolding + design doc. If you're picking this up, start at [.ai/DESIGN.md](.ai/DESIGN.md), then [.ai/decision-log.md](.ai/decision-log.md), then the spec workflow under [.ai/specs/](.ai/specs/).

For AI agents working on this repo, the project-scoped instructions are in [CLAUDE.md](CLAUDE.md) and [.claude/rules/](.claude/rules/).

## License

`LICENSE` is currently a placeholder pending team decision. Likely MIT.
