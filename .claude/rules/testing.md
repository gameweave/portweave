# Testing

Tests use Vitest 4 with a single project at v0.

## Running tests

```bash
npm test                  # Run all tests
npm run test:coverage     # Run with coverage reporting
npm run test:watch        # Watch mode
```

## Test locations

- `src/**/__tests__/*.test.ts` — Tests co-located with source. One `__tests__/` directory per source directory.
- `__tests__/` (root) — Cross-cutting integration tests that don't belong to one module.

## File conventions

- Naming: `[source-file].test.ts` (e.g., `registry.test.ts` for `registry.ts`).
- Each test file imports from its sibling source files using relative paths with explicit `.ts` extensions.
- `structure:check` enforces that test files live in `__tests__/` and have a matching source file at `../`.

## Coverage thresholds

80% across statements/branches/functions/lines, configured in `vitest.shared.ts`. Per-package overrides aren't expected at v0 since we have one package.

## What to test

- **Happy paths**: success cases and expected outputs
- **Error and edge cases**: invalid input, missing files, race conditions
- **Negative testing**: malformed config, lock contention, port conflict during claim

## Mocking

- Mock the filesystem (`fs`) and `child_process` only when the surface under test legitimately depends on them as boundaries; otherwise use real I/O against temp directories from `node:os.tmpdir()`.
- Lean toward real I/O in tests where possible — Portweave's whole point is interacting with the filesystem and processes, so mocks tend to hide bugs.

## Adding a new feature

1. Draft a spec in `.ai/specs/` (use the `create-spec` skill).
2. Write failing tests for the acceptance criteria.
3. Implement.
4. Run `npm run dev-workflow` before pushing.
