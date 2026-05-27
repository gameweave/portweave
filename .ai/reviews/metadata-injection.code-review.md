---
title: 'Metadata Injection — PORTWEAVE_NAMESPACE baseline + ${pw:*} templating'
source: '.ai/specs/metadata-injection/metadata-injection.md'
status: pass-with-notes
severity: low
reviewed: 2026-05-28
reviewer: code-review-subagent
---

# Code Review: Metadata Injection — PORTWEAVE_NAMESPACE baseline + ${pw:\*} templating

## Summary

The implementation faithfully delivers both surfaces the spec specifies — an
always-present `PORTWEAVE_NAMESPACE` baseline and a collision-safe `${pw:<field>}`
template sigil — and the authoritative-namespace precedence exception is correct
and consistent across both consumption modes. Every functional acceptance
criterion is met with strong, real-I/O test coverage. The only blocking gap is
documentary: the spec's required decision-log row has not been appended (the
spec itself gates this on `Status: shipped`, which has not yet been flipped).
Verdict: **pass-with-notes** — one required action (decision-log row), one
recommended action (spec status flip), and a couple of low-value suggestions.

## Source

- **Spec:** `.ai/specs/metadata-injection/metadata-injection.md`
- **Feature doc:** `.ai/features/metadata-injection/metadata-injection.md`
- **Branch:** `main` (uncommitted working tree, diff base `HEAD` = `7580bde`)
- **Files reviewed:** 15 (8 source/config + 6 test + README + schema/example)
- **Changes analyzed:** New `src/env/metadata.ts`; `evaluateTemplate` metadata
  param + `${pw:*}` resolution; `buildEnvMap` baseline + metadata threading;
  authoritative re-assert in `resolve.ts` and `run.ts`; schema validation of
  `${pw:*}` and reservation of the `PORTWEAVE_` env-var prefix; export-surface
  additions; docs (README, schema/v1.json, examples/gameweave.config.json).

## Accuracy Assessment

| Requirement                                                                                                                                     | Status         | Notes                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/env/metadata.ts` exports `buildMetadata`, `PW_METADATA_FIELDS`, `PW_METADATA_PREFIX`, `PORTWEAVE_NAMESPACE_VAR`, `PwMetadataField`         | ✅ Implemented | `metadata.ts:6,11,15,17,23`. Matches the spec's code block verbatim, including `as const satisfies readonly PwMetadataField[]` and type-only `Allocation` import (no runtime cycle).                                 |
| `buildMetadata` maps `namespace`/`worktreeRoot`/`gitCommonDir`; null `gitCommonDir` → `''`                                                      | ✅ Implemented | `metadata.ts:26-32`. `allocation.key.gitCommonDir ?? ''`; `AllocationKey.gitCommonDir` is `null \| string` (`worktree/key.ts:12`). Verified by `metadata.test.ts`.                                                   |
| `buildEnvMap` always emits `PORTWEAVE_NAMESPACE === allocation.namespace` (both `main` and `<slug>-<hash>`)                                     | ✅ Implemented | `build.ts:12-14`. Baseline set before the service loop. Verified by `build.test.ts` (feature-x, main, single-service `toEqual`).                                                                                     |
| `evaluateTemplate` resolves `${pw:namespace/worktreeRoot/gitCommonDir}`, mixes with `${serviceName}`, throws `PW0501` on unknown `pw:` field    | ✅ Implemented | `templates.ts:11-29`. `Object.hasOwn` guard; throws `ENV_BUILD_INVALID`. Verified by `templates.test.ts` (all three fields, empty-gitCommonDir, mixed, unknown-field throw).                                         |
| Config loader accepts `${pw:<known>}`, rejects `${pw:<unknown>}` (`CONFIG_INVALID`), rejects `PORTWEAVE_`-prefixed `envVar`/`discoveryEnv` keys | ✅ Implemented | `schema.ts:111-115,136-140,155-174`. `checkPlaceholder` routes `pw:` to `PW_METADATA_FIELDS`; `RESERVED_ENV_PREFIX` checks in both `recordEnvVar` and `checkDiscoveryEnv`. Verified by 4 new `schema.test.ts` cases. |
| `PORTWEAVE_NAMESPACE` authoritative: `.env` hijack and parent-env raw value both yield `allocation.namespace`                                   | ✅ Implemented | `resolve.ts:46` (post-dotenv re-assert), `run.ts:162` (post-merge re-assert). Verified by `resolve.test.ts` (`.env` hijack) and `run.test.ts` (parent `bogus-parent-value`).                                         |
| Both consumption modes agree (child `PORTWEAVE_NAMESPACE` == `current.env` line)                                                                | ✅ Implemented | Guaranteed structurally: `run.ts:162` sources from `resolvedEnv.env[...]`, which is exactly the value `resolve.ts:46` wrote to `current.env`. See "Patterns & Consistency."                                          |
| No new PW error codes (reuse `ENV_BUILD_INVALID` runtime, `CONFIG_INVALID` load time)                                                           | ✅ Implemented | `errors.ts` unchanged; only `PW0501`/`PW0102` reused.                                                                                                                                                                |
| Coverage thresholds (80% all metrics) met for `metadata.ts` + modified files                                                                    | ✅ Implemented | Per-file numbers strong (`schema.ts` 98.5%); full `dev-workflow` reported green per task context. New file fully exercised by `metadata.test.ts`.                                                                    |
| `npm run dev-workflow` green end-to-end                                                                                                         | ✅ Implemented | Confirmed green by task context; not re-run in full per instructions.                                                                                                                                                |
| Docs: README (`${pw:*}` + baseline var), `schema/v1.json`, `examples/gameweave.config.json`, DESIGN.md §7.2/§7.3, decision-log row              | ⚠️ Partial     | README/schema/example all updated correctly. DESIGN.md §7.2/§7.3 "promise fulfilled" annotation not made; decision-log row NOT appended (see M-1, P-1). Spec gates docs on `shipped`.                                |
| Manual two-worktree verification                                                                                                                | ⚠️ N/A         | Manual criterion — not machine-verifiable in this review. The automated tests cover the equivalent paths (main vs `<slug>-<hash>`, interpolated OTEL var, empty `gitCommonDir`).                                     |

## Completeness Assessment

### Implemented

- `src/env/metadata.ts` (new) — grammar single-source-of-truth, type-only
  `Allocation` import (`metadata.ts:1`) avoids the config↔env runtime cycle the
  spec warns about.
- `src/env/templates.ts` — added required `metadata` param + `pw:` branch
  (`templates.ts:6-29`).
- `src/env/build.ts` — baseline emit + metadata threading (`build.ts:11-14,29-33`).
- `src/env/resolve.ts` — authoritative re-assert past `.env` (`resolve.ts:42-46`).
- `src/cli/run.ts` — authoritative re-assert past parent-env merge
  (`run.ts:160-162`); stale step-7-inversion comment removed/corrected.
- `src/config/schema.ts` — `${pw:*}` validation via extracted `checkPlaceholder`
  helper + `RESERVED_ENV_PREFIX` reservation in both env-var sinks.
- Export surface: `src/env/index.ts` and `src/index.ts` re-export all four
  symbols + `PwMetadataField` type.
- Tests: all six files from the spec's "Test layout" updated/created with the
  exact scenarios enumerated.
- Docs: README field-reference row, `${pw:*}` notes block, dedicated
  `PORTWEAVE_NAMESPACE` section with the authoritative-value caveat; schema
  description; `examples/gameweave.config.json` OTEL example.

### Missing or Incomplete

- **Decision-log row** (`.ai/decision-log.md` ends at row 33). The spec lists
  this as an acceptance criterion and as a header note ("Decision-log rows: to
  append on `Status: shipped`"). The spec status is still `in-progress`, so this
  is consistent with the spec's own gating, but it remains an open required item
  before ship. See M-1.
- **DESIGN.md §7.2 row 4 / §7.3 step 5** "mark the promise fulfilled" — the spec
  scopes this to `in-progress`/`shipped` docs work; not done yet. Low priority
  (DESIGN.md is explicitly "historical rationale"). See P-1.

### Beyond Scope

- `run.ts:122-130` `buildVerboseLines` was lightly refactored (inlined
  `resolveRegistryPath(env).registryFile`, dropped an intermediate
  `registryPaths` local). Functionally inert and unrelated to metadata
  injection; harmless but worth visibility. See S-1.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

None. (M-1 below is documentary, tracked as a Required Action rather than a code defect.)

### 🟡 Minor

- **MI-1**: `evaluateTemplate`'s `metadata` param is typed
  `Readonly<Record<string, string>>` rather than
  `Readonly<Record<PwMetadataField, string>>` — `templates.ts:9`.
  - This is intentional per the spec's code block (which uses the loose
    `Record<string, string>` so `templates.ts` need not value-import the field
    union). The `Object.hasOwn` guard makes it safe and the validator catches
    unknown fields up front. Noting only because the looser type lets a
    typo'd field compile silently in a future internal caller; the runtime
    guard still throws.
  - **Suggested fix:** Acceptable as-is (matches spec). If tightening is
    desired later, `Readonly<Record<PwMetadataField, string>>` would surface
    bad field references at compile time, but it would force a value import of
    the union into `templates.ts`. No action required.

### 🟢 Suggestions

- **S-1**: The `buildVerboseLines` refactor (`run.ts:129`) is unrelated to this
  spec.
  - **Rationale:** Keeping unrelated cleanups out of a feature diff makes review
    and `git blame` cleaner. Inert here, so leaving it is fine; flagging for
    visibility only.
- **S-2**: `checkPlaceholder` casts via `(PW_METADATA_FIELDS as readonly string[]).includes(field)`
  — `schema.ts:162`.
  - **Rationale:** The cast is needed because `.includes` on a narrow literal
    tuple rejects a widened `string`. This is the idiomatic workaround and is
    fine; an alternative is a `Set<string>` built once from `PW_METADATA_FIELDS`
    for O(1) membership, but with three fields the array scan is irrelevant.

## Potential Issues

- **P-1**: DESIGN.md §7.2 row 4 / §7.3 step 5 still read as an unmet promise.
  - **Risk:** A future reader auditing parity could think `PORTWEAVE_NAMESPACE`
    surfacing is still pending. Low impact — DESIGN.md is flagged "historical
    rationale," and the parity test + README now document the real behavior.
  - **Recommendation:** When flipping the spec to `shipped`, add a one-line
    "fulfilled by metadata-injection" annotation to those rows (the spec already
    scopes this work to the shipped step).
- **P-2**: The `${pw:*}` collision-safety argument depends on the invariant that
  service names cannot contain `:` (kebab-case `^[a-z][a-z0-9-]*$`).
  - **Risk:** If `SERVICE_NAME_PATTERN` is ever loosened to permit `:`, the
    `name.startsWith('pw:')` dispatch could shadow a legitimately-named service.
  - **Recommendation:** No action now. The reasoning is captured in
    `metadata.ts:8-11`'s comment; if the service-name pattern ever changes, that
    comment is the breadcrumb. Verified safe today: empty field `${pw:}` slices
    to `''`, which is not in `PW_METADATA_FIELDS` → rejected at validation and
    throws at runtime.

## Code Quality

### Patterns & Consistency

The authoritative-namespace exception is implemented correctly and — importantly
— consistently across both consumption modes. `resolve.ts:46` is the single
source of truth (`final[PORTWEAVE_NAMESPACE_VAR] = allocation.namespace`), and
`run.ts:162` re-asserts from `resolvedEnv.env[PORTWEAVE_NAMESPACE_VAR]` rather
than re-deriving from `allocation` — so the child env is guaranteed to carry the
exact value written to `current.env`. This structurally satisfies the
"both modes agree" criterion rather than relying on two independent computations
staying in sync. The `${pw:*}` runtime resolver (`templates.ts`) and the
load-time validator (`schema.ts:checkPlaceholder`) share `PW_METADATA_FIELDS`/
`PW_METADATA_PREFIX` from `metadata.ts`, so the grammar has one source of truth —
exactly as the spec intends. The runtime throw is correctly framed as
defense-in-depth behind the validator (mirroring the existing unknown-service
throw). Naming, kebab-case filenames, single-quote/no-semicolon style, and
import ordering all conform.

### Error Handling

Compliant with `.claude/rules/error-handling.md`. `evaluateTemplate` throws
`PortweaveError(ENV_BUILD_INVALID, ...)` for the invariant-violation case (no new
code); `resolveEnv` catches `buildEnvMap`'s throw, narrows on
`instanceof PortweaveError`, returns `Result` for the expected case and rethrows
unexpected (`resolve.ts:28-33` — unchanged but the new metadata throw flows
through it correctly). The config validator accumulates `CONFIG_INVALID`
messages via the existing `ctx.errors` pattern. No silent swallows introduced.
No new catch blocks. No `Promise`/floating-promise concerns in the changed code.

### Type Safety

No new `any`. The single `as readonly string[]` cast (`schema.ts:162`) is the
standard widening workaround for `.includes` on a literal tuple, not an unsafe
assertion. `import type { Allocation }` (`metadata.ts:1`) respects
`verbatimModuleSyntax` and prevents the config↔env runtime import cycle the spec
calls out. The `type PwMetadataField` re-export uses inline `type` modifier in
both barrels. All relative imports carry `.ts` extensions.

### Test Coverage

Strong and behavior-focused, all real-I/O per `.claude/rules/testing.md`:

- `metadata.test.ts` (new) covers all three fields, the null→`''` rule, and the
  exact `PW_METADATA_FIELDS` contents.
- `templates.test.ts` covers each `${pw:*}` field, empty `gitCommonDir`, mixing
  `${pw:*}` with `${service}`, and the unknown-field `PW0501` throw — existing
  port-only tests were correctly updated for the new third arg.
- `build.test.ts` asserts the baseline for both `feature-x-...` and `main`,
  `${pw:*}` inside `discoveryEnv`, and the single-service `toEqual` now includes
  `PORTWEAVE_NAMESPACE`.
- `resolve.test.ts` proves the `.env` hijack is ignored in both `env` and the
  written `current.env`.
- `run.test.ts` is the load-bearing cross-mode test: it spawns a real `node`
  child with a parent `PORTWEAVE_NAMESPACE=bogus-parent-value` and asserts the
  child observes `main` AND `current.env` says `main`. This genuinely fails
  without `run.ts:162` (the bogus value is in `io.env`, spread last into
  `mergedEnv`), so it is not a tautological test. Note: the test correctly
  relies on `namespaceOverride()` reading the real `process.env` (not `io.env`),
  so the derived namespace stays `main` while the bogus value lives only in the
  parent-env spread — a precise exercise of the run.ts re-assert.
- `schema.test.ts` covers `${pw:*}` accept, unknown-field reject, and both
  `PORTWEAVE_`-prefixed `envVar` and `discoveryEnv`-key rejections.

Anonymous-mode (`PORT_<n>`) cannot collide with `PORTWEAVE_*`, and the schema
reserves the prefix for file configs, so there is no uncovered path where a user
key overwrites the baseline.

## Verdict

**Status:** pass-with-notes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 0     |
| 🟡 Minor            | 1     |
| 🟢 Suggestions      | 2     |
| ⚠️ Potential Issues | 2     |

### Required Actions

1. Fix M-1: Append the decision-log row to `.ai/decision-log.md` capturing the
   scope split (process management out / identity primitive in), the
   baseline + `${pw:*}` mechanism, and the authoritative-`PORTWEAVE_NAMESPACE`
   precedence exception. This is an explicit acceptance criterion. (The spec
   gates it on `Status: shipped`, so it may be done at the ship step — but it
   must be done before the spec can be marked shipped.)

> Note: M-1 is the only blocking item and is documentary, not a code defect.
> All functional acceptance criteria pass. If the orchestrator treats
> ship-gated docs (decision-log row, DESIGN.md annotation) as part of the
> `shipped` transition rather than the code-review gate, this review is a clean
> `pass-with-notes` and M-1/P-1 become ship-step tasks.

### Recommended Actions

1. Address P-1: When flipping the spec to `shipped`, annotate DESIGN.md §7.2
   row 4 / §7.3 step 5 as fulfilled by this feature, and update the spec's
   `Status:` field from `in-progress` to `shipped`.
2. Address S-1: Consider moving the unrelated `buildVerboseLines` cleanup
   (`run.ts:129`) into a separate commit for a cleaner feature diff (optional).
