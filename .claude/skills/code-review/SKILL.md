---
name: code-review
description: >-
  Review an implementation for accuracy, completeness, and quality against a
  Portweave spec at .ai/specs/<slug>/<slug>.md. Use when reviewing code,
  verifying a spec was implemented correctly, or auditing changes against the
  spec. Invoked as a required gate by the `execute-spec` skill alongside the
  global `/security-review` skill, both running in parallel as subagents
  before a spec can be marked `shipped`.
---

# Code Review

Review an implementation for accuracy, completeness, potential issues, and
quality — measured against a Portweave spec at `.ai/specs/<slug>/<slug>.md`.

## When to Use

- The `execute-spec` skill invokes this as a required parallel review gate
  alongside the global `/security-review` skill before a spec ships.
- A user explicitly asks to "review the code," "check my work," or "verify the
  implementation."
- A user wants to validate implementation against a spec before merging.

This skill never runs against a spec that doesn't exist. If there is no spec
at `.ai/specs/<slug>/<slug>.md`, stop and ask the orchestrator to route to
`create-spec` first.

## Inputs

| Input    | Required | Description                                                                |
| -------- | -------- | -------------------------------------------------------------------------- |
| `source` | Yes      | Path to the spec at `.ai/specs/<slug>/<slug>.md` (or a numbered sub-spec). |
| `scope`  | No       | Limit review to specific files. Defaults to all files changed.             |
| `focus`  | No       | Emphasis area: `accuracy`, `bugs`, `quality`, or `all` (default: `all`).   |

The orchestrator (`execute-spec`) passes `source` explicitly. Do not infer
from session context.

## Process

### 1. Read the Review Format Reference

Read the format definition before doing anything else:

```
.claude/skills/code-review/references/code-review-format.md
```

The output structure below is non-negotiable — the merging step in
`execute-spec` depends on it.

### 2. Read the Source Spec

Read the full spec at the supplied path. Extract:

- All requirements and expected changes
- File paths and before/after code where present
- Acceptance criteria
- Scope boundaries (what's in / out)

Also read the upstream feature doc at `.ai/features/<slug>/<slug>.md` for
motivation context, if one exists.

### 3. Read the Project Contracts

Before reviewing, ground yourself in Portweave's contracts so you don't flag
intentional patterns as issues:

- [.claude/rules/coding-conventions.md](../../rules/coding-conventions.md) — style and conventions
- [.claude/rules/error-handling.md](../../rules/error-handling.md) — `Result<T, E>`, catch-block contract, `OperationalError`, `// pw-allow-swallow:`
- [.claude/rules/testing.md](../../rules/testing.md) — Vitest patterns, coverage thresholds
- [.claude/rules/project-structure.md](../../rules/project-structure.md) — single-package layout, where things go
- [.ai/DESIGN.md](../../../.ai/DESIGN.md) — design decisions to respect

### 4. Identify Changed Files

```bash
git diff origin/main...HEAD --name-only
git diff origin/main...HEAD
```

If `scope` was provided, filter to only those files.

Cross-reference with any "Files Changed" or "Approach" sections in the spec.

### 5. Review for Accuracy

For each requirement in the spec, verify:

- [ ] The requirement is implemented
- [ ] The implementation matches the specified approach (where the spec
      describes one)
- [ ] Behavior matches acceptance criteria
- [ ] No requirements were skipped or partially implemented

Build the **Accuracy Assessment** table from the format reference.

### 6. Review for Completeness

Check that:

- [ ] All files listed in the spec are modified
- [ ] All new files specified are created
- [ ] No spec sections were skipped
- [ ] Tests cover the new code paths
- [ ] Types and interfaces match the spec

Build the **Completeness Assessment** section. Flag anything implemented
beyond the spec's stated scope under "Beyond Scope."

### 7. Review for Issues

Examine each changed file for:

**Correctness**

- Logic errors, off-by-one errors, wrong comparisons
- Null/undefined handling gaps
- Race conditions, async issues (floating promises, misused promises)
- Incorrect type narrowing or casting (especially `any` or unsafe assertions)

**Error Handling (Portweave contract — see .claude/rules/error-handling.md)**

- Catch variables typed `unknown` — must be narrowed before property access
- Catch blocks ending with a logged report, rethrow, or `Result` production —
  never silent-swallow without `// pw-allow-swallow: <reason>`
- `Result<T, E>` used for fallible business logic; throw only for invariants
- `Object.setPrototypeOf` present on custom `Error` subclasses

**Type Safety**

- No new `any` types
- `verbatimModuleSyntax` respected (`import type` where applicable)
- No relative imports missing the file extension

**Concurrency / Filesystem**

- File-locked registry semantics respected (no read-without-lock /
  write-without-lock paths)
- No reliance on temp files that aren't cleaned up
- Stale-entry pruning not bypassed

**Security (basics only — depth is the parallel gate's job)**

Flag obvious things you see (input validation, path traversal, sensitive
data in logs). Deep security analysis is the parallel `/security-review`
gate's job — don't duplicate.

Categorize each issue by severity (Critical, Major, Minor, Suggestion) with
file references and suggested fixes.

### 8. Review for Quality

Assess:

- **Patterns & consistency** — Does the code follow Portweave conventions
  (`Result`, error handling, naming)?
- **Test coverage** — Are changes tested? Do tests verify behavior, not
  implementation?
- **Complexity** — Watch for violations of the ESLint complexity rules
  (max-lines 250, max-lines-per-function 150, max-depth 4,
  cognitive-complexity 15). `complexity:check` enforces these, but a
  reviewer can flag near-the-line code that will break under any small
  extension.
- **Documentation** — `.ai/decision-log.md` updated for non-trivial design
  calls? Spec status updated correctly?

### 9. Identify Potential Issues

Flag risks that aren't bugs today but could become problems:

- Edge cases not covered by tests
- Assumptions that could break under concurrent invocation
- Dependencies on behavior that might change (especially git internals or
  filesystem semantics)
- Missing tests for the multi-worktree / multi-machine scenarios that
  Portweave's whole point depends on

### 10. Determine Verdict

| Findings                                    | Status            |
| ------------------------------------------- | ----------------- |
| No issues                                   | `pass`            |
| Only minor/suggestions                      | `pass-with-notes` |
| Major issues or spec deviations             | `needs-fixes`     |
| Critical issues or fundamental misalignment | `fail`            |

### 11. Write the Review

Write the review to:

```
.ai/reviews/<slug>.code-review.md
```

Where `<slug>` matches the spec folder name. Use the format defined in
`references/code-review-format.md`. Overwrite any existing
`<slug>.code-review.md` — reviews reflect the latest state, not history.

The `.code-review.md` suffix distinguishes this from the security-review
output (`<slug>.security-review.md`), so the orchestrator can find both
when merging.

### 12. Present the Summary

Return to the orchestrator with this exact structure (it's parsed by the
merging step in `execute-spec`):

```
## Code Review Complete: <spec slug>

### Source
.ai/specs/<slug>/<slug>.md

### Verdict
<pass | pass-with-notes | needs-fixes | fail>

### Findings
| Severity | Count |
| --- | --- |
| 🔴 Critical | <N> |
| 🟠 Major | <N> |
| 🟡 Minor | <N> |
| 🟢 Suggestions | <N> |
| ⚠️ Potential Issues | <N> |

### Review Location
.ai/reviews/<slug>.code-review.md

### Required Actions
<numbered list of issue IDs that block ship, or "None">
```

## Quality Checklist

Before finalizing the review, verify:

- [ ] Every requirement from the spec has an accuracy assessment entry
- [ ] Every changed file was examined
- [ ] Every issue has a file:line reference and suggested fix
- [ ] Issues are correctly categorized by severity
- [ ] The verdict matches the severity of findings
- [ ] Required Actions list is complete and actionable
- [ ] Review file written to `.ai/reviews/<slug>.code-review.md`
- [ ] Review follows `references/code-review-format.md`

## Critical Rules

1. **Always read the format reference first** —
   `references/code-review-format.md` is the contract.
2. **Review against the spec, not preference** — The spec is the contract.
   Flag deviations, not alternatives.
3. **Every issue needs a fix suggestion** — Identifying problems without
   solutions is half the job.
4. **Be specific with file references** — `src/registry.ts:42` not
   "somewhere in the registry module."
5. **Don't invent requirements** — Only review against what the spec
   specifies.
6. **Flag beyond-scope changes** — Work that wasn't in the spec isn't
   automatically wrong, but it needs visibility under "Beyond Scope."
7. **Overwrite existing reviews** — A review reflects current state. Don't
   create `code-review-v2.md`.
8. **Stay in your lane on security** — Flag the obvious; let the parallel
   `/security-review` gate do the deep analysis. Don't duplicate effort.
