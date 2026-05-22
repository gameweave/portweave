# Project Structure

Portweave is a single TypeScript package at v0. If we add framework adapters (Vite plugin, Next plugin, etc.) we may grow into a monorepo — but that's a future call.

## Top-level layout

```
src/                 # Library + CLI source
  index.ts           # Library entry (programmatic API)
  cli.ts             # CLI entry (npm bin)
  __tests__/         # Tests co-located per module
scripts/             # Dev-tooling
  bin/               # CLI entry points for npm scripts
  src/               # Shared modules for the scripts
    utils/           # Generic helpers (run-tool, ci-workflow-parser)
    tasks/           # Session-based task management (drop-in from boardflip)
  tool-versions/     # Pinned external-tool versions for CI cache keys
config/eslint/       # Modular ESLint rule configs
.ai/                 # AI/agent artifacts (design, decisions, specs)
.claude/             # Project-scoped AI rules and skills
reference/boardflip/ # Read-only snapshot of boardflip's worktree-port system
```

## Where things go

- **New library code** → `src/<area>/<file>.ts`. Tests under `src/<area>/__tests__/<file>.test.ts`.
- **New CLI subcommands** → wired in `src/cli.ts`, implementation under `src/cli/<subcommand>.ts`.
- **New scripts (devtools)** → bin file under `scripts/bin/`, shared logic under `scripts/src/<module>/`.
- **Config files** → `config/<tool>/`. ESLint subconfigs live in `config/eslint/` and are imported from `eslint.config.ts`.
- **Documentation that AI agents read** → `.ai/` (design, decisions, specs).
- **Documentation that humans read first** → `README.md`, eventual `docs/`.

## What does NOT go anywhere

- **Boardflip's worktree-port code** lives in `reference/boardflip/` as read-only inspiration. **Never import from `reference/`.** Anything we need from there must be rewritten under `src/` to live within Portweave's design.
- **Build output** (`dist/`, `build/`, `coverage/`, `reports/`) is gitignored.
- **Runtime state** (`.portweave/` allocations, `.ai/sessions/`, `.ai/tool-results/`) is gitignored.

## Architectural invariants

- The CLI must be language-agnostic in _what it does_ (everything important goes through env vars + the `.env` file output). It can be JS internally but its consumers don't have to be.
- The library API (`src/index.ts`) must remain optional. Removing it shouldn't break the CLI.
- No daemon. Everything is one-shot processes coordinating through file-locked registry.
- All filesystem state is under `~/.config/portweave/` (registry) or the project's gitignored `.portweave/` (per-project allocation snapshot).
