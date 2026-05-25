---
title: 'Port Allocator and Live Conflict Probe — Security Review'
source: '.ai/specs/port-allocator/port-allocator.md'
status: pass
severity: none
reviewed: 2026-05-26
reviewer: security-review-subagent
---

# Security Review: Port Allocator and Live Conflict Probe

## Summary

**No high-confidence security vulnerabilities identified in this PR.**

The port-allocator implementation introduces a tight, mostly-pure algorithm plus a loopback-only TCP bind probe coordinating through a file-locked registry. The trust model (local CLI, trusted env/CLI inputs, no network surface beyond loopback) holds across every newly-added file.

## Source

- **Spec:** `.ai/specs/port-allocator/port-allocator.md`
- **Files reviewed:** `src/allocator/pool.ts`, `src/allocator/probe.ts`, `src/allocator/allocate.ts`, `src/allocator/allocate.concurrent.ts`, `src/allocator/cross-project.ts`, `src/allocator/order.ts`, `src/allocator/__tests__/fixtures/concurrent-allocator.ts`, `src/allocator/__tests__/_helpers.ts`, `src/__tests__/_concurrent-helpers.ts`
- **Files excluded:** test files (`*.test.ts`) and markdown documentation per the false-positive filtering rules.

## Categories examined and ruled out

| Category                       | Verdict  | Notes                                                                                                                                                                         |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command injection              | No issue | No `exec` / `eval` / shell composition in any new file. `child_process.fork` (test fixture only) is invoked with a fixed module path constant derived from `import.meta.url`. |
| Path traversal                 | No issue | No user-supplied paths joined; test helpers use `tmpdir()` + static prefixes.                                                                                                 |
| Deserialization (RCE)          | No issue | No `JSON.parse` of untrusted input in the allocator. Registry parsing lives in `src/registry/` and was reviewed separately in `.ai/reviews/registry-storage.code-review.md`.  |
| Network exposure               | No issue | TCP probe in `src/allocator/probe.ts` is hard-pinned to `127.0.0.1` (loopback). Comment explicitly explains why `0.0.0.0` would be wrong.                                     |
| Input validation               | No issue | `PORTWEAVE_POOL_RANGE` env var (trusted per project precedents) is strictly validated (`Number.isInteger`, `start > 0`, `end > start`) with silent fallback to defaults.      |
| Authentication / authorization | N/A      | Local-dev CLI, no auth model.                                                                                                                                                 |
| Crypto / secrets               | N/A      | No secrets handled.                                                                                                                                                           |
| Data exposure                  | No issue | Nothing sensitive logged. Test fixture stdout emits port numbers (not sensitive).                                                                                             |
| SSRF                           | No issue | Probe target is hard-pinned to `127.0.0.1`; no URL/host input from anywhere.                                                                                                  |

## Per-file notes

- **`probe.ts`** — TCP probe is correctly pinned to `127.0.0.1` (loopback). No remote exposure. Probe results are not user-controlled. Errors short-circuit to `'taken'` which is the safe default. No injection surface.
- **`pool.ts` / `resolvePoolRange`** — Parses `PORTWEAVE_POOL_RANGE` from env. Even if the env weren't trusted, validation is strict with silent fallback to defaults — no way to produce out-of-range or sign-flipped values. `findFreeBlock` is a pure numeric algorithm with no I/O.
- **`allocate.ts`** — Orchestrator. Reads existing registry entries via `withRegistry` (locked), probes ports, then upserts. No string concatenation into shells, file paths, or queries. `key.namespace` and `key.worktreeRoot` flow only into in-memory equality checks and registry serialization (JSON, handled in the separately-reviewed registry module). The `MAX_PROBE_RETRIES = 100` bound prevents an unbounded loop, though DoS isn't in scope.
- **`allocate.concurrent.ts`** — Exports two constants (a `fileURLToPath`-derived path and a count). `fileURLToPath` on a static `import.meta.url`-relative URL is not attacker-controllable.
- **`cross-project.ts` / `order.ts`** — Comment-only stubs to satisfy `structure:check`. No executable code.
- **Test fixture (`concurrent-allocator.ts`)** — Excluded per the false-positive rule for test files. It only reads env vars set by the parent test runner; no exploit surface.
- **`_helpers.ts` / `_concurrent-helpers.ts`** — Test helpers, excluded. `createRequire` / `require.resolve('tsx/cli')` operates on a static literal, not user input.

## Required actions

None.

## Recommended actions

None.
