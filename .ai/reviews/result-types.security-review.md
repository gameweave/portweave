# Security Review — `result-types` spec (re-review)

**Spec:** [.ai/specs/result-types/result-types.md](../specs/result-types/result-types.md)
**Branch:** `jl/initial-scaffold`
**Diff base:** `origin/main`
**Reviewer:** security-review subagent (execute-spec gate, second pass)

## Verdict

**pass** — no security findings.

## Findings summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 0     |
| Medium   | 0     |
| Low      | 0     |
| Info     | 2     |

All items below are informational notes for future features, not blockers for this spec. Info notes are unchanged from the first review — the remediation pass added only type-only fixture material and documentation, neither of which alters the threat surface.

## What's new since the first pass

The orchestrator applied the code-review's Required Actions. The deltas reviewed here:

- **New file:** `src/__tests__/fixtures/result-fixture.ts` — contains only two `export type` aliases (`SmokeOk = Result<number, string>` and `SmokeErr = Result<never, { code: 'X' }>`). Zero runtime exports, zero side effects, zero imports beyond `import type { Result } from '../../result.ts'`.
- **Modified:** `src/__tests__/result.test.ts` — added `import type { SmokeErr, SmokeOk } from './fixtures/result-fixture.ts'` and a single `expectTypeOf` assertion. Test-only change, no production reach.
- **Modified:** `.ai/decision-log.md` — appended row #17 documenting the `PW####` error-code numbering scheme. Documentation only; no code surface.

None of these introduce I/O, parsing, dynamic dispatch, dependency additions, or runtime behavior. The threat-model assessment below carries over unchanged from the first pass.

## Scope

Cumulative in-scope files for the `result-types` spec on this branch:

- `src/result.ts` (new) — Result primitives
- `src/errors.ts` (new) — `PortweaveError` + `PW_ERROR_CODES`
- `src/index.ts` (modified) — public re-exports
- `src/__tests__/result.test.ts`, `src/__tests__/errors.test.ts` (new)
- `src/__tests__/fixtures/errors-fixture.ts`, `src/__tests__/fixtures/result-fixture.ts` (new)
- `tsconfig.json` (modified) — added `allowImportingTsExtensions: true`
- `package.json` + `package-lock.json` (modified) — knip devDep patch bump `6.14.1 → 6.14.2`
- `.ai/decision-log.md` (modified) — appended row #17 (PW error-code numbering scheme)

Out of scope (unrelated in-flight markdown/docs work on the branch): `.ai/README.md`, `.ai/specs/README.md`, `.claude/skills/*/SKILL.md`, `.ai/features/`, `.ai/roadmaps/`, `.claude/skills/code-review/`.

## Threat-model assessment

This change introduces **foundation-only library code** with no I/O, no user input parsing, no external system access, no dynamic dispatch, and no serialization of untrusted data. The relevant categories from a standard secure-code-review pass:

| Category                             | Applicable? | Notes                                                                                                                                                                             |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection (SQL / shell / template)   | No          | No string interpolation into queries, commands, or templates.                                                                                                                     |
| Path traversal                       | No          | No filesystem operations.                                                                                                                                                         |
| SSRF / outbound network              | No          | No network calls.                                                                                                                                                                 |
| Command injection / `child_process`  | No          | Not used.                                                                                                                                                                         |
| Deserialization / `JSON.parse` abuse | No          | No parsing of external input.                                                                                                                                                     |
| Prototype pollution                  | No          | The single `Object.setPrototypeOf` call sets `this`'s proto to `PortweaveError.prototype` — a static, code-local reference, not a caller-supplied object. Not a pollution vector. |
| Auth / authz bypass                  | No          | No auth surface.                                                                                                                                                                  |
| Secret handling                      | No          | No secrets are read, stored, or logged.                                                                                                                                           |
| Race conditions / TOCTOU             | No          | No shared mutable state, no locking primitives at this layer.                                                                                                                     |
| ReDoS / resource exhaustion          | No          | No regular expressions or unbounded loops.                                                                                                                                        |
| Supply-chain (deps)                  | Reviewed    | Single devDep patch bump; see below. No change since first pass.                                                                                                                  |
| Crypto misuse                        | No          | No cryptographic code.                                                                                                                                                            |
| Information disclosure in errors     | Reviewed    | `Error.message` accepts caller-supplied strings; downstream concern, see Info-1.                                                                                                  |

## File-by-file notes

### `src/result.ts`

Pure functional code. `ok`, `err`, and `andThen` are referentially transparent: they construct fresh object literals and never mutate inputs. `andThen` short-circuits by returning the original failed `Result` unchanged — no closure leakage, no callback invocation on the failure path. `fn` runs synchronously; any throw propagates to the caller (consistent with the project's "no silent swallow" rule in `.claude/rules/error-handling.md`). No security-relevant behavior to flag.

### `src/errors.ts`

`PortweaveError extends Error`. The class:

- Holds a `readonly` `code` field whose type is constrained to the `PW_ERROR_CODES` union — callers cannot construct one with an arbitrary string at the type level (runtime still permits it via `any`, but that's a TS-strictness concern, not a security one).
- Calls `Object.setPrototypeOf(this, PortweaveError.prototype)` — the canonical `instanceof`-safety idiom under TS transpilation. The destination prototype is the class's own static prototype, not caller-controlled, so this is **not** a prototype-pollution vector.
- Does not log, persist, or transmit anything.

`PW_ERROR_CODES` is `as const`. Values are static string literals (`PW0101`, etc.). Exposure of these codes to users/logs is intentional per the spec — they are diagnostic identifiers, not secrets.

### `src/__tests__/*`

Test code; no production surface.

- `fixtures/errors-fixture.ts` imports via a scoped relative path (`../../errors.ts`) — no dynamic imports, no untrusted module resolution.
- `fixtures/result-fixture.ts` is **type-only**: declares two `export type` aliases (`SmokeOk`, `SmokeErr`) over the `Result` discriminated union. Erased at compile time, emits zero runtime JS, ships zero behavior. No reachability from production code paths and no consumer beyond `result.test.ts`.
- `result.test.ts` and `errors.test.ts` exercise the public surface with literal inputs only. The `import type` statement for the smoke fixtures is fully erased.

### `src/index.ts`

Named re-exports only. No wildcard re-exports (consistent with `canonical/no-export-all`). No risk of accidentally re-exporting internal helpers.

### `tsconfig.json`

Added `allowImportingTsExtensions: true`. This is a **compile-time** TypeScript flag with no runtime effect. Paired with the project's existing `noEmit: true`, no `.ts`-suffixed import specifier reaches a downstream JS consumer.

> Note (correctness, **not** security): if/when this package starts emitting JS for distribution, this flag will need to be paired with `rewriteRelativeImportExtensions` or a bundler step so the `.ts` suffixes are rewritten to `.js`. The code-review subagent should track that; it is not in scope here.

### `package.json` / `package-lock.json`

knip `6.14.1 → 6.14.2`. This is a:

- **Patch** bump (no semver-major surface change).
- **devDependency only** — knip is a dead-code static analyzer invoked by `dev-workflow`. It never executes in end-user runtime contexts.
- **Integrity-pinned**: the lockfile's `integrity` SHA-512 hash is updated alongside the version, so npm verifies the tarball against the registry. No floating tag.

No new transitive dependencies are introduced (only the knip entry changed). No security advisory for this version per the public npm advisory feed at time of review. Unchanged from the first pass.

### `.ai/decision-log.md`

Appended row #17 documenting the `PW####` error-code numbering scheme (component-based 100-blocks, addition-order within a block, never renumber a published code). Documentation only — no code change, no operational impact. The numbering scheme itself is not a security boundary; error codes are designed to be publicly visible and stable diagnostic identifiers.

## Informational notes (non-blocking)

### Info-1: error messages are caller-supplied strings

`PortweaveError`'s `message` is a free-form string. When downstream features (config loading, registry I/O) construct these errors, they must avoid embedding secrets or absolute filesystem paths that leak environment topology. This is the standard hygiene concern for any `Error` subclass — flagging here so the next features (`config-loading`, `registry`) inherit awareness. **No action required for this spec.**

### Info-2: `code` is `readonly` at the type level, not at runtime

`PortweaveError#code` is declared `readonly`. TypeScript enforces this at compile time; at runtime the field is a normal data property and could be reassigned by code that bypasses the type system (`(err as any).code = '...'`). For the current threat surface (foundation code, no untrusted callers) this is fine. If `code` ever becomes a security-sensitive routing key (e.g., "only `REGISTRY_LOCKED` triggers retry"), consider `Object.freeze(this)` in the constructor or making `code` a getter over a private field. **No action required for this spec.**

## Required Actions (block ship)

**None.**

## Verification commands

```bash
# In-scope diff
git diff origin/main -- src/result.ts src/errors.ts src/index.ts src/__tests__ tsconfig.json package.json package-lock.json .ai/decision-log.md

# Dep audit (optional confirmation)
npm audit --omit=dev    # production-dep audit; knip is dev-only so should be clean
```
