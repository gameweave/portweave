---
title: 'Security Review: Boardflip Drop-in Acceptance Gate'
source: '.ai/specs/parity-verification/parity-verification.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: security-review-subagent
---

# Security Review: Boardflip Drop-in Acceptance Gate

## Summary

Reviewed the parity-verification implementation for security concerns. The implementation ships an integration test, a sample config file, and a README section — no new production code under `src/`. The primary surface is the test harness itself and how it invokes external processes. One low-severity finding: the inline `node -e` expressions in test invocations include user-controlled data (service names and port numbers from the config), but these are fully controlled by the test fixture and never sourced from runtime user input, so injection risk is theoretical only. Use of `execFile` throughout (not `exec`) is correct and mitigates shell injection. No findings block ship.

## Source

- **Spec:** `.ai/specs/parity-verification/parity-verification.md`
- **Branch:** `jl/v0-layer-3-6`
- **Files reviewed:** 4 (`__tests__/boardflip-parity.test.ts`, `examples/boardflip.config.json`, `README.md`, `knip.json`)
- **Scope:** Integration test harness and example config — no new production library code

## Security Assessment

### Process Execution

The test uses `execFile` exclusively for all process invocations:

```ts
const execFileAsync = promisify(execFile)
await execFileAsync(process.execPath, [cliPath, ...args], { ... })
await execFileAsync('git', args, { cwd })
```

`execFile` does not spawn a shell; arguments are passed as an array. This correctly prevents shell injection even if argument values contain shell metacharacters. This is the right pattern.

The `node -e` inline scripts passed as arguments use only static strings from test constants (env-var names hardcoded in the test, not sourced from user input or the config file at runtime). No injection surface.

### File System Operations

- The test uses `os.tmpdir()` plus `fs.realpathSync()` to resolve macOS symlinks — correct pattern for portable tmpdir usage.
- All test directories are created under the resolved tmpdir and scoped to `pw-parity-*` prefix.
- `fs.rmSync(throwawayDir, { force: true, recursive: true })` in Row 7 is bounded to the throwaway worktree directory inside the test's tmpdir — no path traversal risk; the path is constructed from `path.join(fx.tmpDir, 'throwaway')` where `fx.tmpDir` is the realpathSync-resolved tmpdir.
- Registry reads and writes use `path.join(fx.xdgConfigHome, 'portweave', 'registry.json')` — isolated to the test-scoped XDG directory via `XDG_CONFIG_HOME` env var. The user's real registry at `~/.config/portweave/registry.json` is never touched.

### Environment Variable Isolation

`XDG_CONFIG_HOME` is set per-invocation to `fx.xdgConfigHome` for every `runCli()` call. This ensures:

1. No test modifies the user's real Portweave registry.
2. Tests that need clean registry state start fresh.
3. The merge of `process.env` with the test env (via `{ ...process.env, ...opts.env }`) means test env vars override the ambient environment — correct precedence.

One note: `process.env` is spread into child invocations. If the developer's environment has an `XDG_CONFIG_HOME` set globally, the test's per-call override would win (spread order is `...process.env, ...opts.env`). This is correct behavior.

### JSON Parsing

`JSON.parse(result.stdout)` is used in several places to consume CLI output. These are all:

1. CLI output from the Portweave binary under test — controlled content.
2. Registry file reads for assertion — also controlled content (written by the test fixture).

No external/untrusted JSON is parsed. No risk.

### Network

`net.createServer().listen(port, '127.0.0.1', ...)` binds to loopback only. This is correct — the test does not expose anything to external network interfaces. The bound port is released after the Row 13 assertion completes.

### Secrets and Sensitive Data

- `examples/boardflip.config.json` contains no secrets — only service names, env-var names, and URL templates.
- No credentials, tokens, or private data anywhere in the implementation.
- `README.md` migration section contains no sensitive guidance.

### Dependency Surface

No new dependencies introduced. `execFile` and `net` are Node.js built-ins.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor

None.

### 🟢 Suggestions

- **S-SUGG-1**: The inline `-e` script in `testRow1` includes a complex expression: `"const k=Object.keys(process.env).filter(k=>k.endsWith('_PORT')||k==='SES_LOCAL_PORT');console.log(JSON.stringify(Object.fromEntries(k.map(k=>[k,process.env[k]]))))"`. This is passed as a `node -e` argument via `execFile` (array, no shell expansion) — safe. But the complexity of the expression makes it slightly hard to audit. Not a security issue, purely readability.
  - **Rationale:** Could extract to a `buildPortFilterScript()` helper (analogous to `buildEnvReadScript()`). Not blocking.

## Potential Issues

- **P-SEC-1**: `testRow11` writes a temporary `use-runtime.mjs` file to `fx.mainDir` (inside the test's tmpdir). This file is not cleaned up explicitly; cleanup happens only when the OS reclaims the tmpdir. In long-running test sessions, many such files could accumulate in tmpdir. This is a hygiene concern, not a security concern.
  - **Risk:** Disk space in tmpdir; stale `.mjs` files if `tmpdir` is `/tmp` on Linux (which persists across sessions).
  - **Recommendation:** Add cleanup of `consumerPath` in `testRow11` itself, or note it as acceptable because the tmpdir is process-scoped via the `pw-parity-*` prefix and would be cleaned by OS tmpdir rotation.

## Code Quality (Security Lens)

### Input Validation

The test does not accept external input — all test fixture data is constructed programmatically from constants defined in the test file. No user-supplied data flows into process invocations.

### Least Privilege

The test process runs as the current user with no privilege escalation. Port binding in Row 13 uses `127.0.0.1` (loopback). File operations are confined to the test's tmpdir.

### Dependency Integrity

No new dependencies introduced. `execFile` (built-in) preferred over `exec` (shell-expansion risk) — this is the correct choice and was verified in the implementation.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 0     |
| 🟢 Suggestions      | 1     |
| ⚠️ Potential Issues | 1     |

### Required Actions

None. The implementation uses `execFile` throughout (correct), isolates the registry via `XDG_CONFIG_HOME` (correct), binds only to loopback (correct), and handles no external/untrusted input. No security issues block ship.

### Recommended Actions

1. Address P-SEC-1: Consider explicit cleanup of `consumerPath` (`use-runtime.mjs`) in `testRow11` after the assertion, or add a note explaining why OS rotation is sufficient.
