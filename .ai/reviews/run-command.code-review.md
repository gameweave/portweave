---
title: 'Code Review: portweave run CLI wrapper'
source: '.ai/specs/run-command/run-command.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: code-review-subagent
---

# Code Review: portweave run CLI wrapper

## Summary

The `run-command` implementation correctly implements the full orchestration pipeline (worktree-context → config → allocate → env-resolution → banner → spawn) across four new source files and a rewritten `src/cli.ts`. All acceptance criteria from the spec are met. One spec inconsistency was found in the env-merge spread order (the spec's inline example contradicts its own stated intent; the implementation correctly follows the stated intent). Two minor quality notes and one suggestion are raised; none block ship.

## Source

- **Spec:** `.ai/specs/run-command/run-command.md`
- **Feature doc:** `.ai/features/run-command/run-command.md`
- **Branch:** `jl/exec-run-command`
- **Files reviewed:** 7 (src/cli.ts, src/cli/run.ts, src/cli/banner.ts, src/cli/spawn.ts, src/errors.ts, src/cli/**tests**/run.test.ts, src/cli/**tests**/banner.test.ts, src/cli/**tests**/spawn.test.ts, src/cli/**tests**/\_helpers.ts)
- **Changes analyzed:** New CLI layer — commander root, run subcommand orchestrator, banner formatter, child-process wrapper, shared test helpers

## Accuracy Assessment

| Requirement                                                                                                             | Status         | Notes                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `src/cli.ts` exports `buildCli()` and `main(argv)`; commander root with `--config`, `--count`, `--verbose` global flags | ✅ Implemented | `buildCli` and `main` both exported; `enablePositionalOptions()` present |
| `registerRunCommand` wires `run` subcommand; `runCommand(childArgs, options, io?)` returns `Promise<number>`            | ✅ Implemented | Both exported from `src/cli/run.ts`                                      |
| Orchestration order: worktree-context → config → allocate → env-resolution → banner → spawn                             | ✅ Implemented | `runCommand` follows spec order exactly                                  |
| `stdio: 'inherit'` in `spawnChild`                                                                                      | ✅ Implemented | `src/cli/spawn.ts:43`                                                    |
| SIGINT and SIGTERM forwarded to child; handlers torn down after exit                                                    | ✅ Implemented | `src/cli/spawn.ts:45–69`                                                 |
| Spawn failure → `err(PortweaveError(CLI_CHILD_SPAWN_FAILED))` → exit 127                                                | ✅ Implemented | `src/cli/spawn.ts:71–82`, `src/cli/run.ts:169`                           |
| `--config` + `--count` mutual exclusion → exit 1 with `CLI_INVALID_FLAGS`                                               | ✅ Implemented | `src/cli/run.ts:67–73`                                                   |
| Empty child args → exit 1 with `CLI_INVALID_FLAGS`                                                                      | ✅ Implemented | `src/cli/run.ts:75–81`                                                   |
| `--count` non-integer or non-positive → exit 1 with `CLI_INVALID_FLAGS`                                                 | ✅ Implemented | `src/cli/run.ts:83–93`                                                   |
| `--count N` anonymous mode injects `PORT_1..PORT_N`                                                                     | ✅ Implemented | via `synthesizeAnonymousConfig`, verified in tests                       |
| `--config <path>` loads named file                                                                                      | ✅ Implemented | via `loadConfig(cwd, { configPath })`                                    |
| Banner goes to `io.stderr`                                                                                              | ✅ Implemented | `src/cli/run.ts:150` writes to `io.stderr`                               |
| `formatAllocationBanner` produces correct shape (header, verb, service rows, wrote line, launching line)                | ✅ Implemented | `src/cli/banner.ts`, verified by banner.test.ts                          |
| `formatAllocationBanner` importable by show-command; accepts `launchingCommand?: string` and `reused: boolean`          | ✅ Implemented | Interface defined; tests verify the show-command path                    |
| `verboseLines` inserted after `wrote` line and before `launching` line                                                  | ✅ Implemented | `src/cli/banner.ts:60–64`                                                |
| `resolveExitCode` maps signal → 128 + signal-number; spawn failure → 127                                                | ✅ Implemented | `src/cli/spawn.ts:97–115`                                                |
| `CLI_INVALID_FLAGS=PW0601`, `CLI_CHILD_SPAWN_FAILED=PW0602` added to `PW_ERROR_CODES`                                   | ✅ Implemented | `src/errors.ts:5–6`                                                      |
| `commander` in `dependencies`                                                                                           | ✅ Implemented | `package.json` — upgraded to `^14.0.0` (see Beyond Scope)                |
| Build produces executable `dist/cli.js` with shebang; `node ./dist/cli.js --help` works                                 | ✅ Implemented | `tsconfig.build.json` added; build verified                              |
| Coverage ≥ 80% across new source files                                                                                  | ✅ Implemented | dev-workflow test step passes; all 284 tests pass                        |
| `npm run dev-workflow` green                                                                                            | ✅ Implemented | All 13 steps pass                                                        |

## Completeness Assessment

### Implemented

- `src/cli.ts` — rewritten from 4-line stub to full commander root with `buildCli()` and `main()`
- `src/cli/run.ts` — complete orchestrator with `RunIo`, `RunOptions`, `runCommand`, `registerRunCommand`
- `src/cli/banner.ts` — pure `formatAllocationBanner` + `formatErrorLine`
- `src/cli/spawn.ts` — `spawnChild` with signal forwarding + `resolveExitCode`
- `src/cli/__tests__/banner.test.ts` — all banner shapes covered
- `src/cli/__tests__/spawn.test.ts` — exit codes + spawn failure + AbortSignal forwarding
- `src/cli/__tests__/run.test.ts` — orchestration, flag validation, anonymous mode, signal forwarding (consolidated from 4 spec-named files)
- `src/cli/__tests__/_helpers.ts` — shared test helpers (makeCapturingIo, makeSilentIo, makeTmpGitRepo, cleanupDir)
- `src/errors.ts` — two new PW codes added
- `tsconfig.build.json` — new emit-capable tsconfig using `rewriteRelativeImportExtensions: true`
- `package.json` — `commander` in dependencies; build script updated

### Missing or Incomplete

- The spec defines separate test files (`run-flags.test.ts`, `run-anonymous.test.ts`, `run-signals.test.ts`) but the implementation consolidated them into `run.test.ts`. The behavior is fully covered; the split was eliminated to satisfy `structure:check` (each `*.test.ts` must have a matching source file). This is a valid pragmatic adjustment, not a gap.

### Beyond Scope

- `commander` upgraded from the spec-specified `^12.1.0` to `^14.0.0`. The spec said "add `commander@^12.1.0` to dependencies" but `upgrade:check` (a hard gate in `dev-workflow`) exits 1 when outdated deps are found. Upgrading to `^14.0.0` was necessary to satisfy the dev-workflow gate. The API surface used (`Command`, `parseAsync`, `.option`, `.command`, `.argument`, `.action`) is stable across the version boundary; no behavioral change.
- `tsconfig.build.json` introduced as a separate emit-enabled tsconfig; spec mentioned reconciling `noEmit` but did not specify the exact approach. Using `rewriteRelativeImportExtensions: true` (TypeScript 6.x) to emit `.js` from `.ts` imports is a clean solution.
- The `registerShowCommand` stub in `src/cli.ts` wires a functional "coming soon" `show` command rather than a no-op placeholder. This is consistent with the spec's coordination call-out about Wave B3 merge compatibility.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: Spec inconsistency in env-merge spread order — `src/cli/run.ts:160`
  - The spec's step 7 says the merged env is `{ ...io.env, ...resolvedEnv.env }` but the acceptance criterion (line 200) says "parent process env overrides everything." In JavaScript spread, the last spread wins, so `{ ...io.env, ...resolvedEnv.env }` would make `resolvedEnv.env` the winner — contradicting the stated intent. The implementation uses `{ ...resolvedEnv.env, ...io.env }` which correctly places `io.env` (parent env) last, so parent env wins on conflict. The implementation is correct; the spec's inline example is wrong.
  - **Suggested fix:** No code change needed. Append a clarifying comment inline: `// parent env spread last → parent wins on key conflict (spec §step7 example is inverted)`

- **MI-2**: `spawnChild` receives `io: Pick<RunIo, 'stderr' | 'stdout'>` but `stdio: 'inherit'` makes these fields unused — `src/cli/spawn.ts:8,43`
  - With `stdio: 'inherit'`, the child directly inherits the parent's file descriptors; `io.stderr` and `io.stdout` from the options are never written to in the normal path. The fields only have value if `stdio` is later changed to `'pipe'`. This is not a bug but a stale interface contract.
  - **Suggested fix:** Either remove `io` from `SpawnChildOptions` (since it's unused) or add a comment explaining the interface is pre-wired for a future `stdio: 'pipe'` mode (e.g. `portweave run --capture`).

### 🟢 Suggestions

- **S-1**: `resolveExitCode` falls back to `1` when both `exitCode` and `signal` are null — `src/cli/spawn.ts:103-104`
  - Per Node.js docs, an `exit` event can theoretically fire with both null values if the process was killed externally before it started. Return code `1` is reasonable but undocumented. A comment would make the intent explicit.
  - **Rationale:** Defensive code paths should be documented; this is a subtle POSIX edge case.

## Potential Issues

- **P-1**: SIGINT forwarding inside Vitest — `src/cli/__tests__/run.test.ts:286`
  - The signal-forwarding test sends `process.kill(process.pid, 'SIGINT')` to the Vitest parent process. This works because Vitest installs its own SIGINT handler that yields to the test. If a future Vitest version changes SIGINT handling (e.g., to terminate the runner immediately), this test could become flaky. The test has `timeout: 10000` and a `// pw-allow-swallow:` comment on the missing marker file, which is appropriate.
  - **Risk:** Test flakiness in future Vitest upgrades.
  - **Recommendation:** Keep the `describe.skipIf(isWindows)` guard. Consider adding a brief comment explaining why `process.kill(process.pid, 'SIGINT')` is used instead of `child.kill()` in the test.

- **P-2**: `buildVerboseLines` calls `resolveRegistryPath(env)` on every `runCommand` invocation in verbose mode — `src/cli/run.ts:123`
  - The call is cheap (path resolution, no I/O) but if `resolveRegistryPath` ever gains async behavior or side effects, the verbose path would silently acquire new latency.
  - **Risk:** Low at v0; noting for awareness.
  - **Recommendation:** No action needed at v0.

## Code Quality

### Patterns & Consistency

The implementation consistently applies Portweave's patterns: `Result<T, E>` for all fallible operations in the orchestration pipeline, `PortweaveError` with stable `PW####` codes, and dependency injection via `RunIo` for testability. The `WriteErrorOptions` interface (introduced to satisfy `max-params=4`) is idiomatic. The extraction of `resolveConfig`, `spawnWithBanner`, and `buildVerboseLines` keeps `runCommand` at exactly 30 statements (at the `max-statements` limit). Service row iteration uses `!(service.name in ports)` guard rather than a non-null assertion, which is correct per the Portweave error-handling contract.

### Error Handling

All catch variables are typed `unknown` and narrowed before access. The `main()` function in `src/cli.ts` has three narrowed branches (`PortweaveError`, `Error`, and unknown), each producing appropriate stderr output. No silent swallows exist without comments. `PortweaveError.setPrototypeOf` is present in `src/errors.ts:29`. The `// pw-allow-swallow:` comment appears correctly at `run.test.ts:293` where the signal-timing marker file may legitimately not exist.

### Type Safety

All imports use `import type` where appropriate (`verbatimModuleSyntax` compliant). Relative imports include `.ts` extensions. No `any` types. The `chunk: Buffer | string` typing in test helpers avoids `unsafe-argument`. The `typeof ec === 'number' ? ec : 0` guard in `main()` correctly handles `process.exitCode`'s `string | number` type.

### Test Coverage

All acceptance criteria have tests. The consolidated `run.test.ts` covers: orchestration (7 tests), flag validation (6 tests), anonymous mode (4 tests), and signal forwarding (1 test, Windows-skipped). `banner.test.ts` covers all formatting variants including the show-command path and padding alignment. `spawn.test.ts` covers the four main spawn outcomes. Shared helpers in `_helpers.ts` prevent jscpd duplication violations (measured at 0.54%, well below the 1.05% threshold).

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 2     |
| 🟢 Suggestions      | 1     |
| ⚠️ Potential Issues | 2     |

### Required Actions

None — no Critical or Major issues found. The implementation correctly meets all acceptance criteria.

### Recommended Actions

1. Address MI-1: Add inline comment clarifying env-merge spread order (parent wins) in `src/cli/run.ts:160` to prevent future confusion with the spec's inverted example.
2. Address MI-2: Either remove unused `io` from `SpawnChildOptions` or add a comment explaining the pre-wiring intent in `src/cli/spawn.ts`.
3. Address S-1: Add a comment to the `return 1` fallback in `resolveExitCode` explaining the null/null edge case.
