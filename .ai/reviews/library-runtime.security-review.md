---
title: 'Security Review: portweave/runtime library API'
source: '.ai/specs/library-runtime/library-runtime.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-26
reviewer: security-review-subagent
---

# Security Review: portweave/runtime library API

## Summary

The library-runtime implementation introduces a thin facade over the existing port-allocator and env-resolution pipeline, an upward filesystem walker, a smoke test that invokes child processes, and a new `exports` field in `package.json`. No critical or major security issues were found. Two low-severity notes are flagged: (1) the upward filesystem walk swallows all errors (including EACCES) silently, which could mask unexpected permission issues; (2) the smoke test's `execFileAsync` invocations pass user-controlled values to npm/npx, which is safe in test context but warrants documentation. The overall security posture is appropriate for a local-dev tool at v0.

## Scope

Files reviewed for security:

- `src/runtime/index.ts`
- `src/runtime/upward-walk.ts`
- `src/runtime/exports-smoke.ts`
- `src/runtime/__tests__/exports-smoke.test.ts`
- `src/runtime/error-passthrough.ts`
- `src/errors.ts`
- `package.json`
- `tsconfig.build.json`

## Threat Model Context

Portweave is a local-dev CLI tool running with the user's full filesystem permissions. The threat surface at v0 is:

1. **Filesystem access** — reading/writing user files; paths derived from `cwd` and `configPath`
2. **Registry mutation** — writing to `~/.config/portweave/registry.json` under a directory-mutex lock
3. **Child process execution** — only in the smoke test (test code, not production)
4. **Information disclosure** — error messages that might expose sensitive paths

The primary adversary model is **accidental misuse** (user passes unexpected input to `cwd`/`configPath`), not active exploitation. Portweave has no network-facing surface at v0.

## Findings

### 🔴 Critical

None.

### 🟠 Major

None.

### 🟡 Minor / Low Severity

- **SEC-1**: `upward-walk.ts` swallows all errors from `fs.access`, not just `ENOENT`. If a directory in the walk path has restricted permissions (EACCES), the walk silently skips past it rather than surfacing the error. This means the caller cannot distinguish "no config exists" from "config exists but is inaccessible." — `src/runtime/upward-walk.ts:18-20`
  - **Impact:** Low. Users in unusual permission configurations (e.g., home directory entries with 000 permissions) would get `RUNTIME_CONFIG_NOT_FOUND` when the config exists but is unreadable. Confusing, but not a security risk in the traditional sense — the user cannot gain access to configs they're not permitted to read.
  - **Recommended fix:** Check `error.code !== 'ENOENT'` and rethrow non-ENOENT errors (or surface them as a `Result` error). This was identified as S-2 in the code review as well.

- **SEC-2**: `exports-smoke.ts` and `exports-smoke.test.ts` use `execFileAsync` with npm/npx to perform real installs and builds. The `packDir` and `consumerDir` paths are generated from `tmpdir()` + `process.pid` + `Date.now()` which is not cryptographically random. In a concurrent test environment, a collision between two test runs in the same process could cause interference. — `src/runtime/exports-smoke.ts:42-43`, `src/runtime/__tests__/exports-smoke.test.ts:39-43`
  - **Impact:** Very low. This is test-only code not shipped in production. The collision probability is negligible. No security boundary is crossed — the temp paths are user-owned.
  - **Recommended fix:** Use `crypto.randomUUID()` or `fs.mkdtemp` for guaranteed uniqueness. This is the pattern already used in other Portweave test fixtures (e.g., `resolve.test.ts` uses `process.pid.toString() + Date.now().toString()`, so this is consistent).

### 🟢 Suggestions / Informational

- **SEC-S1**: The `opts.configPath` parameter in `resolveConfigForRuntime` is resolved via `resolvePath(cwd, opts.configPath)`. This means a caller can pass `configPath: '../../etc/passwd'` and the function will attempt to load it. Since `loadConfig` reads arbitrary JSON files, this is a valid path traversal vector in theory. In practice, Portweave is a local-dev tool where the caller _is_ the user — there is no privilege separation to defend. This is noted for completeness, not as an action item.
  - **Risk:** Informational only at v0. If Portweave ever runs in a privileged context (e.g., as a system service), path traversal in `configPath` would need validation.
  - **Recommendation:** No action needed at v0. Document in `.ai/decision-log.md` if/when Portweave expands to multi-user or privileged contexts.

- **SEC-S2**: Error messages produced by `PortweaveError` instances include filesystem paths (e.g., the `RUNTIME_CONFIG_NOT_FOUND` message includes the `cwd`). On shared systems, error messages surfaced to logs could expose directory structures. For a local-dev tool this is appropriate — the user needs the path to diagnose the problem.
  - **Risk:** Informational only. No action needed at v0.

- **SEC-S3**: `tsconfig.build.json` enables `rewriteRelativeImportExtensions: true`. This is a TypeScript compiler option that rewrites `.ts` extensions to `.js` in emitted output. There is no known security implication from this compiler option. It is used to enable emission (the main `tsconfig.json` has `noEmit: true`) and is scoped to the build tsconfig only.
  - **Risk:** None identified.

## Registry and Lock Security

The runtime inherits the `withRegistry` lock from `src/registry/storage.ts` via `allocate()`. No new lock paths are introduced. The lock uses `fs.mkdir` on a lock directory (`<registry>.lock`) which is the existing atomic mechanism. Two in-process callers racing through `resolveRuntime` will both flow through `withRegistry` and serialize correctly, consistent with the spec's design intent.

No new registry write paths are introduced by this spec. The `resolveEnv` call that writes `.portweave/current.env` uses `atomicWriteDotenv` (an atomic write with a temp file + rename pattern) which was already reviewed in the env-resolution spec.

## Supply Chain

- No new runtime dependencies added. The new `tsconfig.build.json` and `package.json` `exports` field changes have no supply chain implications.
- The smoke test uses `npm pack` + `npm install` on the package itself (a local file: dependency). No external packages are pulled in beyond what's already in `package.json`.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity         | Count |
| ---------------- | ----- |
| 🔴 Critical      | 0     |
| 🟠 Major         | 0     |
| 🟡 Minor         | 2     |
| 🟢 Informational | 3     |

### Required Actions

None. Both minor findings (SEC-1, SEC-2) are low-severity informational items that do not affect security correctness at v0 scale.

### Recommended Actions

1. Address SEC-1: Narrow the error swallow in `upward-walk.ts` to ENOENT only; rethrow or surface unexpected errors (EACCES, EPERM) so the caller can diagnose permission problems.
2. Address SEC-2: Consider using `crypto.randomUUID()` or `os.mkdtemp()` for temp directory names in the smoke test helpers.
