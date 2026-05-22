---
title: 'Result types and PW error codes'
source: '.ai/specs/result-types/result-types.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-23
reviewer: code-review-subagent
---

# Code Review: Result types and PW error codes

## Summary

Second-pass review of the foundation spec that introduces `Result<T, E>` and
the `PortweaveError` / `PW_ERROR_CODES` namespace. Both Required Actions from
the prior review (`needs-fixes`) have been addressed: the type-only
`result-fixture.ts` now exists and is exercised by `result.test.ts`, and a
row #17 in `.ai/decision-log.md` records the PW numbering scheme with the
seed codes called out. All eight acceptance criteria are now satisfied;
`npm run dev-workflow` is green end-to-end (13/13 steps, 16/16 tests).
Remaining notes are minor / suggestion-level and intentionally deferred.

## Source

- **Spec:** `.ai/specs/result-types/result-types.md`
- **Feature doc:** `.ai/features/result-types/result-types.md`
- **Branch:** `jl/initial-scaffold`
- **Files reviewed:** 8 in-scope (2 new source, 2 new tests, 2 new fixtures, 2 modified config) plus the re-exporting `src/index.ts` and the decision-log row
- **Changes analyzed:** Result primitives, PortweaveError class, PW seed codes, public re-export surface, tsconfig `allowImportingTsExtensions` flip, knip 6.14.1 → 6.14.2 patch bump, decision-log row 17

## Accuracy Assessment

| Requirement                                                                                                                                                                         | Status         | Notes                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1: `src/result.ts` exports `Result<T, E>`, `ok`, `err`, `andThen` with the exact signatures shown in `.claude/rules/error-handling.md`.                                           | ✅ Implemented | Structurally identical; property and union ordering normalized by the project's `perfectionist` plugin (alphabetical). `src/result.ts:1-12`.                                                                                              |
| AC2: `Result<T, E>` narrows under TypeScript without casts under `strict` + `verbatimModuleSyntax`.                                                                                 | ✅ Implemented | Demonstrated by the `classify` function in `src/__tests__/result.test.ts:74-84`; discriminant union narrows cleanly inside `if (input.ok)`.                                                                                               |
| AC3: `src/errors.ts` exports `PortweaveError`, `PortweaveErrorCode`, and `PW_ERROR_CODES` containing exactly the five seed entries with the numeric values from the PW range table. | ✅ Implemented | All five codes present with the expected `PW####` values. `src/errors.ts:1-7`; asserted exactly via `toStrictEqual` in `src/__tests__/errors.test.ts:46-66`.                                                                              |
| AC4: `new PortweaveError(code, msg) instanceof PortweaveError` returns `true` when thrown from one module file and caught in another.                                               | ✅ Implemented | `src/__tests__/fixtures/errors-fixture.ts` throws across the boundary; `errors.test.ts:25-36` catches and asserts `instanceof`. `Object.setPrototypeOf` is in place at `src/errors.ts:19`.                                                |
| AC5: `src/index.ts` re-exports the public surface; imports of `ok`, `err`, `PortweaveError`, etc. work from any descendant module.                                                  | ✅ Implemented | `src/index.ts:1-6` re-exports `PortweaveError`, type `PortweaveErrorCode`, `PW_ERROR_CODES`, `andThen`, `err`, `ok`, and type `Result`. Type-only exports correctly marked with `type` keyword for `verbatimModuleSyntax`.                |
| AC6: `import type { Result } from '../../result.ts'` resolves with no runtime side effects, with a fixture file under `src/__tests__/fixtures/` serving as the smoke.               | ✅ Implemented | `src/__tests__/fixtures/result-fixture.ts:1-4` performs the type-only import (`SmokeOk`, `SmokeErr` type aliases, no runtime exports); `result.test.ts:3,86-89` imports and asserts the aliases via `expectTypeOf`. `typecheck` is green. |
| AC7: `npm run dev-workflow` is green at the end of the feature, including `test`, `lint`, `typecheck`, and `structure:check`.                                                       | ✅ Implemented | Re-ran during this review: 13/13 steps pass, 16/16 tests pass, coverage thresholds met for `result.ts` and `errors.ts`.                                                                                                                   |
| AC8: A row in `.ai/decision-log.md` records the PW numbering scheme.                                                                                                                | ✅ Implemented | Row #17 added at `.ai/decision-log.md:25`. Captures the 100-block ranges, the addition-order assignment rule, the "never renumber" invariant, and lists the five seed codes with their numeric values.                                    |

## Completeness Assessment

### Implemented

- `src/result.ts` — `Result<T, E>` discriminated union plus `ok`, `err`, `andThen`.
- `src/errors.ts` — `PW_ERROR_CODES` const map, `PortweaveErrorCode` derived
  union type, `PortweaveError` class with `Object.setPrototypeOf` guard.
- `src/index.ts` — re-exports the entire public surface, with `type`
  modifiers on the type-only exports.
- `src/__tests__/result.test.ts` — covers `ok`/`err` payload + discriminant,
  `andThen` success chaining + short-circuit + propagation, type
  preservation, `result.ok` narrowing, and the fixture-aliased type smoke.
- `src/__tests__/errors.test.ts` — covers code/message reporting,
  `instanceof Error`, cross-module `instanceof PortweaveError`, throw/catch
  with `expect().toThrow()`, and the exact `PW_ERROR_CODES` shape.
- `src/__tests__/fixtures/result-fixture.ts` — type-only `SmokeOk` /
  `SmokeErr` aliases; pure type-import file, no runtime emit.
- `src/__tests__/fixtures/errors-fixture.ts` — sibling fixture that throws a
  `PortweaveError` across the module boundary for the `instanceof` test.
- `tsconfig.json` — `allowImportingTsExtensions: true` added so the
  `.ts`-extensioned imports the spec uses typecheck cleanly.
- `.ai/decision-log.md` — row #17 ratifies the PW numbering scheme and
  references the spec as the establishing source.

### Missing or Incomplete

- None. All eight acceptance criteria are satisfied.

### Beyond Scope

The following uncommitted changes appear on the branch but are NOT part of
the result-types spec. They are workflow infrastructure and should not block
this review:

- `.ai/README.md`, `.ai/specs/README.md` — restructured to describe the
  `features/`, `roadmaps/`, `specs/<slug>/<slug>.md` folder layout.
- `.claude/skills/create-feature/SKILL.md`, `.claude/skills/create-spec/SKILL.md`,
  `.claude/skills/execute-spec/SKILL.md` — updates to the skill set.
- `.ai/features/`, `.ai/reviews/`, `.ai/roadmaps/` — new workflow
  directories.
- `.claude/skills/code-review/` — new project-scoped skill (the one running
  this review).
- `package.json` + `package-lock.json` — `knip` patch bump 6.14.1 → 6.14.2.
  Authorized tag-along fix to unblock `dev-workflow`'s `upgrade:check`.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None. (M-1 and M-2 from the prior review are both closed by the
remediation.)

### 🟡 Minor

- **MI-1**: `Result` type union and member order rearranged from the
  reference contract — `src/result.ts:8,10,12`
  - **Suggested fix:** No code change required; this is the `perfectionist`
    plugin sorting properties alphabetically (`error` before `ok`, `ok`
    before `value`) and reordering the union (`{ ok: false }` arm first).
    The types are structurally identical to the contract in
    `.claude/rules/error-handling.md`. Tracked here only so future readers
    don't perceive a drift between the rule's example and the committed
    code. A one-paragraph callout in `coding-conventions.md` (see S-1)
    would close this permanently.

- **MI-2**: Declarations appear in alphabetical order (`andThen`, `err`,
  `ok`, then `type Result`) — `src/result.ts:1-12`
  - **Suggested fix:** TypeScript hoists type declarations, so the
    backwards reading order is valid at every gate (`tsc --noEmit` is
    green). Same root cause as MI-1: `perfectionist`. Flagging so it
    isn't re-litigated per spec.

### 🟢 Suggestions

- **S-1**: Document the `perfectionist` normalization once in
  `.claude/rules/coding-conventions.md` — global
  - **Rationale:** Both MI items above stem from the same source — spec
    examples written in "natural" reading order get re-sorted on landing.
    A one-paragraph note in the conventions rule would save a re-litigation
    per spec.

- **S-2**: `errors.ts` lacks JSDoc on the public surface —
  `src/errors.ts:1,12`
  - **Rationale:** Conventions explicitly say "default to no comments,"
    so this is a deliberate suggestion not a defect. But `PortweaveError`
    is going to be hit by every downstream feature and every consumer of
    the library API; a one-liner above the class ("subclass of Error
    carrying a stable PW#### code for cross-module dispatch") and another
    above `PW_ERROR_CODES` pointing to the range table in
    `.ai/decision-log.md` row 17 is the kind of "non-obvious why" the
    convention allows. Optional.

- **S-3**: Add `mapErr` (or similar) when a real caller needs it —
  `src/result.ts:1-6`
  - **Rationale:** Explicitly out of scope for this spec ("no `map`, no
    `unwrap`"). Flagged so the next feature that hits a
    code-path-needs-this moment adds the helper here rather than inlining
    at the caller.

## Potential Issues

- **P-1**: `PortweaveErrorCode` is a string-union derived from
  `PW_ERROR_CODES`, with no compile-time check that values match
  `/^PW\d{4}$/` — `src/errors.ts:1-10`
  - **Risk:** A typo like `'PW051'` (three digits) or `'pw0101'` would
    compile fine and silently drift from the invariant the spec's range
    table enforces socially. Not a bug today (the seed codes are correct),
    but a guard would catch future drift cheaply.
  - **Recommendation:** When the next feature lands its first new code,
    add a template-literal-type constraint
    (`type _PWCodeShape = (typeof PW_ERROR_CODES)[keyof typeof PW_ERROR_CODES] extends `PW${number}` ? true : never`)
    or a runtime regex assertion in `errors.test.ts`. Explicitly out of
    scope for this spec.

- **P-2**: `Object.setPrototypeOf` invariant has no test that exercises
  the failure mode it guards against — `src/errors.ts:19`
  - **Risk:** Removing the `setPrototypeOf` call would silently pass
    every test today because all tests run under the same Vitest target
    where `extends Error` happens to work. A future contributor cleaning
    up "redundant" code could remove it and break `instanceof` only in
    distributed bundles.
  - **Recommendation:** Optional. If you want to lock it in, add a test
    that asserts `Object.getPrototypeOf(error) === PortweaveError.prototype`
    explicitly. Documentation in `.claude/rules/error-handling.md`
    partially covers this already.

- **P-3**: Spec uses `.ts` extensions in imports, and
  `allowImportingTsExtensions: true` was added to `tsconfig.json` to make
  that typecheck — `tsconfig.json:7`, `src/index.ts:1-6`,
  `src/__tests__/*.ts`, `src/__tests__/fixtures/*.ts`
  - **Risk:** Non-portable to a future `tsc --emit` build that doesn't
    want `.ts` in import paths. Portweave's current setup uses `tsx` for
    execution and `tsc --noEmit` for checking, so it's fine today. But
    the eventual publish step (Feature N when the library is shipped to
    npm) will need to either keep `allowImportingTsExtensions` on with a
    matching `--module` setting, or strip the extensions across the tree.
  - **Recommendation:** Not blocking. Could be captured in a future
    decision-log row when the publish pipeline is designed; until then
    the convention in `coding-conventions.md` already mandates extensions
    and the choice is internally consistent.

## Code Quality

### Patterns & Consistency

The two source files are small, focused, and match the contracts in
`.claude/rules/error-handling.md`. Naming is idiomatic (`Result`, `ok`,
`err`, `andThen`, `PortweaveError`, `PW_ERROR_CODES`). The `as const`
literal map pattern for codes is the right shape for both string-union
derivation and JSON-stable serialization (when an observability layer
eventually picks it up). The re-export shape in `src/index.ts` cleanly
separates the type-only exports (`type PortweaveErrorCode`, `type Result`)
from the runtime ones, satisfying `verbatimModuleSyntax`.

### Error Handling

`PortweaveError` follows the project contract: `extends Error`,
`Object.setPrototypeOf(this, PortweaveError.prototype)`, a `readonly code`
field, a fixed `name`. The cross-module `instanceof` test in
`errors.test.ts:25-36` proves the invariant at the test level. No silent
swallow anywhere; no `// pw-allow-swallow:` needed at this layer because
there's no real I/O yet. The catch block at `errors.test.ts:29` correctly
types `e: unknown` and narrows via `instanceof` before reading `caught.code`.

`Result<T, E>` is the discriminant union the contract specifies. No
`unwrap`/`expect` shortcuts were introduced — good, the spec explicitly
excludes them.

### Type Safety

- No `any` types anywhere in the in-scope diff.
- `import type` is used correctly throughout (`src/index.ts:3-4,6`,
  `src/__tests__/result.test.ts:2-3`, `src/__tests__/errors.test.ts:4`,
  `src/__tests__/fixtures/result-fixture.ts:1`).
- All relative imports include the `.ts` extension as the conventions
  require.
- `expectTypeOf<...>().toEqualTypeOf<Result<...>>()` is the right tool
  for the type-narrowing acceptance criterion and is used in four places
  in `result.test.ts` (lines 16, 31, 70, 87-88).
- The `allowImportingTsExtensions: true` flip is the minimum-surface way
  to keep the `.ts`-import convention typechecking; flagged under P-3 for
  future durability, not as a defect.

### Test Coverage

- `result.test.ts` covers: `ok` / `err` payload + discriminant,
  `andThen` success chaining, `andThen` short-circuit on prior failure,
  `andThen` propagation of downstream failure, type preservation through
  the chain, the `result.ok` narrowing acceptance criterion, and the
  fixture-aliased type smoke. Solid behavior-level coverage.
- `errors.test.ts` covers: code + message reporting, `instanceof Error`,
  cross-module `instanceof PortweaveError`, throw/catch with
  `expect().toThrow()`, exact `PW_ERROR_CODES` shape (via
  `toStrictEqual`), and key list.
- Total: 16 tests, all passing. Coverage thresholds met (validated by
  `dev-workflow`'s `test` step).
- Multi-worktree / concurrent / filesystem-edge scenarios are
  intentionally out of scope at this layer (the spec calls this out
  explicitly: "No file-system or process tests at this layer — that
  pressure lands when Features 3–4 add real registry I/O.") — correct
  posture.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 2     |
| 🟢 Suggestions      | 3     |
| ⚠️ Potential Issues | 3     |

### Required Actions

None. Both Required Actions from the prior review (M-1: missing
type-only fixture; M-2: missing decision-log row) are closed.

### Recommended Actions

1. Address S-1 by adding a one-paragraph callout to
   `.claude/rules/coding-conventions.md` (or `error-handling.md`)
   explaining that the `perfectionist` plugin will alphabetize
   properties, union arms, and top-level declarations. Closes MI-1 and
   MI-2 permanently as documentation rather than per-spec churn.
2. Address S-2 opportunistically: a one-line JSDoc above
   `PortweaveError` and `PW_ERROR_CODES` pointing to the spec's range
   table / decision-log row 17. Optional.
3. Address P-1 / P-2 / P-3 opportunistically when the next feature lands
   or when the publish pipeline is designed — not blocking this review.
