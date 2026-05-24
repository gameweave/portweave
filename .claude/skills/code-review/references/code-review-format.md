# Code Review Format

A code review evaluates an implementation against its source spec for
accuracy, completeness, correctness, and quality. The output is a structured
markdown document that communicates findings clearly and actionably, and that
the `execute-spec` orchestrator can merge with the parallel `/security-review`
output without ambiguity.

## File Location

```
.ai/reviews/<slug>.code-review.md
```

Where `<slug>` matches the spec folder name (e.g.,
`.ai/reviews/worktree-context.code-review.md` for the spec at
`.ai/specs/worktree-context/worktree-context.md`).

The `.code-review.md` suffix is mandatory — it distinguishes this output
from `.security-review.md` so the orchestrator can find both reviews when
merging findings.

## Template

```markdown
---
title: '<Human-Readable Review Title>'
source: '.ai/specs/<slug>/<slug>.md'
status: pass | pass-with-notes | needs-fixes | fail
severity: none | low | medium | high | critical
reviewed: YYYY-MM-DD
reviewer: code-review-subagent
---

# Code Review: <Title>

## Summary

<2-4 sentences summarizing the review outcome. State what was reviewed,
against which spec, and the overall verdict. Mention the most significant
finding if any.>

## Source

- **Spec:** `.ai/specs/<slug>/<slug>.md`
- **Feature doc:** `.ai/features/<slug>/<slug>.md` (if present)
- **Branch:** `<branch name>`
- **Files reviewed:** <count>
- **Changes analyzed:** <brief scope description>

## Accuracy Assessment

How faithfully the implementation matches the spec requirements.

| Requirement                       | Status                                   | Notes     |
| --------------------------------- | ---------------------------------------- | --------- |
| <Requirement from spec section 1> | ✅ Implemented / ⚠️ Partial / ❌ Missing | <details> |
| <Requirement from spec section 2> | ✅ Implemented / ⚠️ Partial / ❌ Missing | <details> |

## Completeness Assessment

Whether all specified changes have been made.

### Implemented

- <List of completed items with file references>

### Missing or Incomplete

- <List of items not yet implemented or only partially done, with file references>

### Beyond Scope

- <Any changes made that were NOT in the spec — flag for discussion>

## Issues Found

Issues are categorized by severity and type. **Each issue gets a stable ID**
(C-1, M-1, MI-1, S-1, P-1) so the orchestrator can reference it during
remediation. IDs must be unique within this file.

### 🔴 Critical

Must be fixed before ship. Includes correctness bugs, data loss risks,
security vulnerabilities, severe spec violations.

- **C-1**: <description> — `<file:line>`
  - **Impact:** <what breaks or could break>
  - **Suggested fix:** <concrete suggestion>

### 🟠 Major

Should be fixed before ship. Includes logic errors, missing error handling,
spec deviations, broken `Result` contracts.

- **M-1**: <description> — `<file:line>`
  - **Impact:** <what's affected>
  - **Suggested fix:** <concrete suggestion>

### 🟡 Minor

Should be fixed but won't block ship if explicitly accepted. Includes style
issues, naming, minor inefficiencies, narrow type-safety gaps.

- **MI-1**: <description> — `<file:line>`
  - **Suggested fix:** <concrete suggestion>

### 🟢 Suggestions

Optional improvements. Nice-to-have enhancements that go beyond the spec.

- **S-1**: <description> — `<file:line>`
  - **Rationale:** <why this would be an improvement>

## Potential Issues

Problems that aren't bugs yet but could become issues.

- **P-1**: <description> — `<file:line>`
  - **Risk:** <what could go wrong>
  - **Recommendation:** <how to mitigate>

## Code Quality

### Patterns & Consistency

<Does the code follow Portweave conventions? Are naming patterns consistent?
Are similar problems solved the same way?>

### Error Handling

<Catch variables narrowed? Result<T, E> used appropriately? No silent
swallows without `// pw-allow-swallow:`? Custom Error subclasses use
`Object.setPrototypeOf`?>

### Type Safety

<Are types precise? Any new `any` types? Are `import type` declarations used
under `verbatimModuleSyntax`? Are relative imports including file
extensions?>

### Test Coverage

<Are new code paths tested? Are edge cases in tests? Do tests verify
behavior, not implementation? Are the multi-worktree / concurrent /
filesystem-edge scenarios covered?>

## Verdict

**Status:** <pass | pass-with-notes | needs-fixes | fail>

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | <N>   |
| 🟠 Major            | <N>   |
| 🟡 Minor            | <N>   |
| 🟢 Suggestions      | <N>   |
| ⚠️ Potential Issues | <N>   |

### Required Actions

Numbered list of items that MUST be addressed before the review passes.
Reference issues by ID so the orchestrator's remediation pass can target
them precisely.

1. Fix C-1: <short description>
2. Fix M-2: <short description>

### Recommended Actions

Numbered list of items that SHOULD be addressed but aren't blocking.

1. Address MI-1: <short description>
```

## Status Definitions

| Status            | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `pass`            | Implementation matches spec, no issues found                                    |
| `pass-with-notes` | Implementation matches spec, only minor/suggestion-level findings               |
| `needs-fixes`     | Implementation has major issues or spec deviations that must be addressed       |
| `fail`            | Implementation has critical issues or is fundamentally misaligned with the spec |

## Severity Definitions

| Severity   | Meaning                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `none`     | No issues found                                                           |
| `low`      | Only minor issues or suggestions                                          |
| `medium`   | Major issues present but no critical problems                             |
| `high`     | Critical issues found that must be fixed                                  |
| `critical` | Fundamental implementation problems, potential data loss or security risk |

## Guidelines

- **Review against the spec, not personal preference.** The spec is the
  source of truth. Flag deviations from the spec, not alternative approaches
  you would prefer.
- **Every issue needs a file reference.** Point to the specific file and
  line where the issue lives.
- **Suggest fixes, don't just flag problems.** A review that says "this is
  wrong" without suggesting a fix is incomplete.
- **Distinguish "wrong" from "different."** If the implementation achieves
  the spec goal through a different approach, that's not necessarily an
  issue — note it under Beyond Scope.
- **Check the edges.** Error paths, null cases, empty collections,
  concurrent access, and boundary values are where bugs hide. For Portweave
  specifically: multi-worktree contention, machine-wide pool exhaustion,
  external-process port collisions, stale lock cleanup.
- **Be specific in the summary.** "Implementation is mostly correct with 2
  major issues in registry locking" is useful. "Looks okay" is not.
- **Required actions are the contract.** The implementer must address every
  Required Action for the review to pass. Recommended Actions are advisory.
- **Stable issue IDs.** C-1, M-1, MI-1, S-1, P-1 — once assigned in a
  review, do not renumber if the review is re-run after remediation.
  Closed issues are removed; open issues keep their original IDs so the
  orchestrator can track progress.
