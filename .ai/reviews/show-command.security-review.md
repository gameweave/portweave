---
title: 'portweave show — Security Review'
source: '.ai/specs/show-command/show-command.md'
status: pass
severity: none
reviewed: 2026-05-26
reviewer: security-review-subagent
---

# Security Review: portweave show

## Summary

**No high-confidence security vulnerabilities identified in this PR.**

The `show` subcommand is a read-only introspection surface on top of the already-reviewed registry, allocator, and env-resolution layers. It performs zero writes to user data (only `handle.touch` to bump `lastUsedAt` via the locked registry path), spawns no subprocesses, executes no shell, and reads only files already governed by upstream specs. Output is serialized via `JSON.stringify` and `formatAllocationBanner` (pure formatter) — no string interpolation surfaces.

## Source

- **Spec:** `.ai/specs/show-command/show-command.md`
- **Files reviewed:** `src/cli/show.ts`, `src/cli/banner.ts` (stub for cross-merge with run-command), `src/errors.ts` (added `CLI_NO_ALLOCATION=PW0603`), and the `package.json` / `package-lock.json` deltas.
- **Files excluded:** test files (`*.test.ts`) and markdown documentation per the false-positive filtering rules.

## Categories examined and ruled out

| Category                       | Verdict  | Notes                                                                                                                                                                                 |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command injection              | No issue | No `exec` / `eval` / shell composition. `runShow` only calls into `withRegistry` and pure formatters.                                                                                 |
| Path traversal                 | No issue | The single file system input is `key.worktreeRoot` from `resolveAllocationKey` — already canonicalised by the worktree-context layer. `loadConfig` receives a resolved absolute path. |
| Deserialization (RCE)          | No issue | No `JSON.parse` of untrusted input here; registry parsing lives in the separately-reviewed `src/registry/` module.                                                                    |
| Network exposure               | No issue | No network calls; show is purely local.                                                                                                                                               |
| Input validation               | No issue | `--json` is a boolean flag; `cwd` is a trusted process input. No untrusted strings reach a sink.                                                                                      |
| Authentication / authorization | N/A      | Local-dev CLI, no auth model.                                                                                                                                                         |
| Crypto / secrets               | N/A      | No secrets handled.                                                                                                                                                                   |
| Data exposure                  | No issue | `--json` and the banner emit port numbers, namespace, worktree root — all non-PII configuration values the user owns.                                                                 |
| SSRF                           | N/A      | No URL/network inputs.                                                                                                                                                                |

## Per-file notes

- **`src/cli/show.ts`** — Read-only path. `withRegistry` is invoked with a function that calls `handle.touch(key)` on cache hit; the registry layer enforces the lock. No filesystem writes outside the registry path itself.
- **`src/cli/banner.ts`** — Stub at v0 in this worktree; the integration merge with run-command's worktree replaces it with the real formatter. The stub returns a fixed placeholder — no injection surface.
- **`src/errors.ts`** — Adds a constant (`CLI_NO_ALLOCATION='PW0603'`) to a frozen `as const` literal. No runtime risk.

## Required actions

None.

## Recommended actions

None.
