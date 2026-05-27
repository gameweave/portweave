# AI Development Workflow — MANDATORY

**After ANY code changes, run `npm run dev-workflow` before declaring the task complete.**

## What it runs

`scripts/bin/dev-workflow.ts` orchestrates the full quality suite in order. At v0 the steps are:

1. `format:check` — Prettier
2. `lint` — ESLint flat config
3. `typecheck` — `tsc --noEmit` against `tsconfig.json` and `tsconfig.config.json`
4. `dupcheck` — jscpd
5. `similarity:check` — similarity-ts (skipped if Rust toolchain absent)
6. `deadcode:check` — knip
7. `structure:check` — tests-in-`__tests__/` + source-file alignment
8. `complexity:check` — ESLint complexity rules only
9. `constants:check` — duplicate-literal / magic-number detection
10. `docs:freshness:check` — skipped if `docs/` absent
11. `ci-workflow:check` — install-before-check ordering
12. `test` — Vitest with coverage
13. `upgrade:check` — `npm outdated`

Order matters: fast/cheap checks first so expensive ones don't run if a basic gate fails. The orchestrator stops at the first failing step.

## Flags

```bash
npm run dev-workflow              # Full suite (use this before push)
npm run dev-workflow -- --skip-tests   # Skip the test step (dev iteration only)
npm run dev-workflow -- --quick        # Skip test, upgrade, similarity (faster sanity check)
```

## Pre-commit hook

Husky runs the fast subset on every commit (format:check + lint + typecheck). The heavier checks run at pre-push (or in CI). See `.husky/pre-commit`.

## CI

GitHub Actions runs `npm run dev-workflow` on PRs and on `main`. See `.github/workflows/ci.yml`. The `ci-workflow:check` script validates this workflow file's install-before-check ordering — keep installs (`actions/checkout`, `actions/setup-*`, `npm ci`, `cargo install`) before any check step within a job.

## Growth path

This v0 dev-workflow is intentionally thin — most steps are direct wrappers around the underlying npm tool. Candidate enhancements as the codebase warrants the complexity:

- Cached tool results (skip re-running if inputs unchanged)
- Structured "task output" format for AI orchestration
- File-targeted mode (only check the files that changed)
- Auto-fix mode
