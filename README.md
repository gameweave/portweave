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

## Contributing

We're early. The current state is scaffolding + design doc. If you're picking this up, start at [.ai/DESIGN.md](.ai/DESIGN.md), then [.ai/decision-log.md](.ai/decision-log.md), then the spec workflow under [.ai/specs/](.ai/specs/).

For AI agents working on this repo, the project-scoped instructions are in [CLAUDE.md](CLAUDE.md) and [.claude/rules/](.claude/rules/).

## License

`LICENSE` is currently a placeholder pending team decision. Likely MIT.
