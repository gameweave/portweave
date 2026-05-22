# CLAUDE.md

## Project overview

Portweave is an OSS utility for zero-thought, conflict-free local-dev port allocation across multiple projects and git worktrees. It will be published under the Gameweave organization at `gameweave/portweave`.

**Status:** Pre-v0 scaffolding. The actual port-allocation logic hasn't been implemented yet — current state is the design doc, decision log, and full development infrastructure.

For full design context, read [.ai/DESIGN.md](.ai/DESIGN.md) and [.ai/decision-log.md](.ai/decision-log.md) before doing non-trivial work.

## Quick reference

```bash
npm install              # Install deps (Node 24+, npm 11+)
npm run build            # tsc --build
npm run dev-workflow     # Full quality suite (REQUIRED before push)
npm test                 # Run tests
npm run typecheck        # Type-check without emitting
npm run lint             # ESLint
npm run lint:fix         # Auto-fix lint
npm run format           # Auto-format with Prettier
npm run format:check     # Check formatting
```

Static analysis checks (also wrapped in `dev-workflow`):

```bash
npm run dupcheck             # jscpd code duplication
npm run similarity:check     # similarity-ts (requires Rust)
npm run deadcode:check       # knip dead-code detection
npm run structure:check      # Tests-in-__tests__/ + source-alignment
npm run complexity:check     # ESLint complexity rules only
npm run constants:check      # Duplicate-literal detection
npm run docs:freshness:check # Doc frontmatter freshness
npm run ci-workflow:check    # Install-before-check ordering in CI
npm run upgrade:check        # npm outdated
```

Task management (large-scale fix orchestration, drop-in from boardflip):

```bash
npm run task:init -- --session <name>
npm run task:add
npm run task:get
npm run task:next
npm run task:set-status
npm run task:status
npm run task:check-complete
```

## Pre-push validation (REQUIRED)

```bash
npm run dev-workflow
```

This is the gate before pushing code. It runs all quality checks CI enforces. See [.claude/rules/ai-dev-workflow.md](.claude/rules/ai-dev-workflow.md) for the full step list and growth path.

## Repository layout

- `src/` — Library + CLI source. Implementation lands as features are specified under `.ai/specs/`.
- `scripts/bin/` — CLI entry points for npm scripts. Each is a thin wrapper at v0 — Brian will layer in caching + structured task output over time.
- `scripts/src/` — Shared modules:
  - `utils/` — `run-tool.ts`, `ci-workflow-parser.ts`
  - `tasks/` — Session-based task management (drop-in from boardflip)
- `config/eslint/` — Modular ESLint rule configs (complexity, error-handling, quality, perfectionist, file-type-overrides, tooling-overrides)
- `.ai/` — Design docs, decision log, in-flight specs ([read first](.ai/README.md))
- `.claude/rules/` — Project instructions for AI agents
- `.claude/skills/` — Project-scoped skills (`create-spec`, `execute-spec`, `create-feature`)
- `reference/boardflip/` — **Read-only** snapshot of boardflip's worktree-port system. The design inspiration. Never import from here at runtime.

## Code style

- TypeScript strict mode, ES2024 target, Node16 modules
- Single quotes, no semicolons, trailing commas (Prettier)
- Tests: Vitest 4, `*.test.ts` files in `__tests__/` directories co-located with source
- Node.js 24+ required
- See [.claude/rules/coding-conventions.md](.claude/rules/coding-conventions.md) for full conventions

## Error handling

`Result<T, E>` for fallible business logic the caller must handle; `throw` for invariant violations. Catch variables typed `unknown` — narrow before reading. Never silent-swallow without a `// pw-allow-swallow:` comment. Full contract: [.claude/rules/error-handling.md](.claude/rules/error-handling.md).

## Key patterns

- **Machine-wide pool, not per-project offset.** Boardflip uses `base + offset*100` per project. Portweave allocates blocks from a single global pool at `~/.config/portweave/registry.json`. See DESIGN.md §5.1.
- **Stateless, file-locked, no daemon.** All coordination happens through the registry file with directory-mutex locking. See DESIGN.md §5.6.
- **Two consumption modes from one code path.** `portweave run` injects env vars into the child process AND writes `.portweave/current.env` as a side effect. See DESIGN.md §5.2.
- **Drop-in for boardflip.** v0 must be adoptable as a direct replacement for boardflip's worktree-port system. See DESIGN.md §7.

## Working on new features

1. Use the `create-feature` skill (or `create-spec` then `execute-spec` separately). Specs live in `.ai/specs/`.
2. Reference the boardflip patterns in `reference/boardflip/` — they're the design blueprint, not source to import.
3. Tests first. Implementation second. `dev-workflow` before push.
4. Append to `.ai/decision-log.md` for non-trivial design decisions.

## What Brian will add

Significant contributions expected to:

- The skill set under `.claude/skills/` (the current files are starting points)
- The `dev-workflow` orchestrator — adding caching, structured task output, file-targeted mode
- The `scripts/src/utils/` shared infrastructure
- The actual library/CLI implementation under `src/`

## Documentation

User-facing docs: `README.md`
AI-facing docs: `.ai/` and `.claude/`

Don't create top-level docs/ until there's user-facing content to put there.
