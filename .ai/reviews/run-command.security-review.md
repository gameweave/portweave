---
title: 'Security Review: portweave run CLI wrapper'
source: '.ai/specs/run-command/run-command.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: security-review-subagent
---

# Security Review: portweave run CLI wrapper

## Summary

The `run-command` implementation handles user-controlled inputs safely. No shell injection, path traversal, privilege escalation, or sensitive-data-in-logs vulnerabilities are present. The signal-forwarding design is correct and does not introduce race conditions. Two low-severity notes are raised around verbose-mode path disclosure and the unvalidated child-argv passthrough; neither blocks ship in a local-dev tool.

## Scope

Files reviewed:

- `src/cli.ts`
- `src/cli/run.ts`
- `src/cli/banner.ts`
- `src/cli/spawn.ts`
- `src/errors.ts`
- `src/cli/__tests__/run.test.ts`
- `src/cli/__tests__/spawn.test.ts`
- `src/cli/__tests__/_helpers.ts`

Branch: `jl/exec-run-command` against `origin/main`.

## Threat Model

`portweave run` is a local-dev CLI wrapper. Its threat surface is:

1. **Child argv** — the user-supplied command after `--`. No sanitization is needed for an explicit CLI wrapper (the user IS the attacker if they craft a malicious command), but the implementation must not inadvertently add shell-injection surface.
2. **Config file paths** — `--config <path>` is user-supplied. Path traversal must be considered.
3. **Environment variable injection** — Portweave-allocated ports are injected into the child env. If port values can be attacker-controlled, env injection could carry payloads.
4. **Verbose output** — `--verbose` prints filesystem paths to stderr. Sensitive in CI contexts.
5. **Signal handling** — SIGINT/SIGTERM forwarding; incorrect teardown could leave signal handlers installed across tests.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

- **MI-1**: Verbose mode prints absolute filesystem paths (worktreeRoot, gitCommonDir, registry path, config path) to stderr — `src/cli/run.ts:127–131`
  - These paths could expose internal filesystem layout in CI logs. For a local-dev tool this is acceptable (user opted in via `--verbose`), but worth documenting.
  - **Suggested fix:** No code change needed at v0. The spec explicitly accepts this (open question §2: "recommend keeping verbose unredacted at v0"). Add a note to the decision log that `--verbose=safe` is the future mitigation path.

- **MI-2**: Child argv is not validated for path traversal or shell metacharacters — `src/cli/run.ts:174`, `src/cli/spawn.ts:43`
  - `spawn(cmd, args, { stdio: 'inherit' })` is used (not `exec`), which means no shell is involved — there is no shell injection risk. However, `cmd` could be a relative path (`../../../evil`) allowing a user to run binaries outside their PATH. For a CLI wrapper where the user explicitly supplies the command, this is by-design behavior (matching boardflip's approach), not a vulnerability.
  - **Suggested fix:** No code change. Add a comment to `spawnChild` noting that `spawn` (not `exec`) is used intentionally to prevent shell injection; relative path execution is a user-intent feature, not a bug.

### 🟢 Suggestions

- **S-1**: The `stdio: 'inherit'` design correctly prevents the child from receiving `io.stderr`/`io.stdout` Writable streams via the spawn options, but the `SpawnChildOptions` interface still carries `io: Pick<RunIo, 'stderr' | 'stdout'>` — `src/cli/spawn.ts:8`
  - If a future contributor changes `stdio` from `'inherit'` to `'pipe'` for output capture, they might expect `io.stderr` writes to go to the user-visible stream. Without the `stdio: 'inherit'` invariant being documented, there's a risk of the captured output being silently dropped.
  - **Rationale:** Explicit invariants in security-relevant I/O code prevent future mistakes.

## Security Assessment by Area

### Input Validation

**Child argv:** User-supplied command is passed directly to `child_process.spawn` with no shell intermediary (`stdio: 'inherit'`). This is the correct approach — `spawn` does not invoke a shell, so shell metacharacters in argv are inert. There is no injection risk.

**`--config <path>`:** User-supplied config paths are passed to `loadConfig(cwd, { configPath })`. The config-loader spec handles path resolution relative to `cwd`; the security posture of that module is out of scope for this review. No additional path sanitization happens at the CLI layer, but since the tool runs as the user, reading any file the user can read is expected behavior.

**`--count <n>`:** The count value is parsed via `Number(opts.count)` then validated as a positive integer before use. The validation correctly rejects non-integer floats and zero/negative values. The count is then used only to call `synthesizeAnonymousConfig(count)` — a pure function that generates service definitions. No injection surface.

### Environment Variable Injection

Portweave injects allocated port numbers (integers) into the child env. Port numbers come from the allocator, which probes real TCP ports — the values are machine-assigned integers, not user-controlled strings. There is no path for an attacker to inject arbitrary strings as port values through the Portweave allocation pipeline.

The env merge order `{ ...resolvedEnv.env, ...io.env }` ensures the parent process env takes precedence. A malicious `portweave.config.json` in the working directory could define `PATH` as an env var (since `envVar` is user-configurable), which would then be injected into the child and potentially shadow the system PATH. However:

1. The user must own the `portweave.config.json` file to place it in the working directory.
2. Parent env wins (spread last), so `PATH` from the parent would override any `PATH` from resolvedEnv.
3. This is a local-dev tool running as the current user — filesystem ownership is the trust boundary.

No injection risk beyond the expected "user controls config" model.

### Signal Handling

SIGINT and SIGTERM handlers are installed on `process` immediately after `spawn`, and torn down in a `teardown()` called from both the `exit` and `error` event handlers. The teardown uses `process.off` (reference equality — not a named-string lookup), which correctly removes only the specific handler instances. Multiple concurrent `spawnChild` calls (not a use case for `portweave run` but worth noting) would stack-install handlers correctly since each call installs its own named function references.

The AbortSignal path (`options.signal?.addEventListener('abort', abortHandler)`) correctly removes the listener via `removeEventListener` with the same function reference. No listener leak.

The Vitest signal-forwarding test sends `process.kill(process.pid, 'SIGINT')` in-process, which correctly exercises the real handler path. The test uses `describe.skipIf(isWindows)` since Windows does not support POSIX signals.

### Sensitive Data Exposure

Error messages include the child command name (e.g., `failed to spawn "nonexistent-xyz-9999": ...`) and the PortweaveError message. These are written to stderr, not stdout, keeping stdout pipelines clean. No secrets, tokens, or sensitive env var values are written to error output.

Verbose lines include:

- Absolute config path
- Absolute registry path
- `AllocationKey` JSON (includes `worktreeRoot` and `gitCommonDir`)

These are diagnostic paths, not secrets. They are appropriate for `--verbose` mode. The open question in the spec about `--verbose=safe` mode is correctly deferred to v0 follow-up.

### Error Handling (Security Angle)

All `PortweaveError` instances include stable `PW####` codes that do not expose internal stack traces unless `--verbose` is set. The `main()` catch block only exposes the stack trace when `--verbose` is in `argv` — the verbose flag is read from the raw argv array before commander parsing, which is the correct approach (avoids relying on commander state that may not be populated in an early error path).

No `any` types in the changed files, no `as` casts on user-controlled values, no `eval`/`Function` constructor usage.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 2     |
| 🟢 Suggestions      | 1     |
| ⚠️ Potential Issues | 0     |

### Required Actions

None — no Critical or Major security issues found.

### Recommended Actions

1. Address MI-1: Append a decision-log note that `--verbose` unredacted is intentional at v0 and `--verbose=safe` is the future mitigation path.
2. Address MI-2: Add a comment to `spawnChild` noting that `spawn` (not `exec`) prevents shell injection, and that relative-path execution is user-intent behavior.
3. Address S-1: Document the `stdio: 'inherit'` invariant in `SpawnChildOptions` to prevent future contributors from accidentally creating a silent-drop scenario when changing I/O mode.
