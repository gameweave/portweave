---
name: create-spec
description: Draft an implementation spec for a new Portweave feature under .ai/specs/. Use when the user wants to propose, scope, or write up a new capability before implementing it. Follows Portweave's spec template (Problem / Approach / Acceptance criteria / Open questions).
---

# create-spec

## When to invoke

Trigger this skill when the user signals "let's spec out X" or "draft a spec for Y" or "before we build this, let's write it down" — anything that suggests they want the _design_ captured before code lands.

Do NOT trigger for:

- Trivial fixes / typo corrections
- Refactors with no behavior change
- Tasks the user wants to just-do-now

## What to produce

A single markdown file at `.ai/specs/<kebab-case-feature>.md` following the template in [.ai/specs/README.md](../../../.ai/specs/README.md). Required sections:

1. **Status** (always starts as `draft`)
2. **Owner** (user-provided or "TBD")
3. **Decision-log rows** (cross-reference to `.ai/decision-log.md` if applicable)
4. **Problem** — what does this solve, for whom, why now
5. **Approach** — concrete recommended approach with file paths / code references
6. **Acceptance criteria** — checklist of verifiable conditions
7. **Open questions** — anything blocking implementation

## How to drive the conversation

1. **Read [.ai/DESIGN.md](../../../.ai/DESIGN.md)** first so the spec aligns with the resolved design decisions.
2. Confirm with the user: feature name, scope boundaries, and which §7.2 parity row this maps to (if any).
3. Identify which boardflip reference files in [reference/boardflip/](../../../reference/) are relevant. Cite their patterns.
4. Draft the spec. Lean on existing decisions from `.ai/decision-log.md` rather than re-litigating.
5. Surface genuine open questions in §Open questions rather than papering them over.
6. After writing, ask the user to review and confirm `Status: approved` before any code lands. Implementation goes through `execute-spec`.

## Quality bar

- Acceptance criteria must be _verifiable without asking the spec author_. Bad: "registry is robust." Good: "concurrent invocations from N processes never produce overlapping allocations (verified via integration test under `src/__tests__/registry.concurrent.test.ts`)."
- Approach should reference existing code (`reference/boardflip/scripts/src/utils/...`) by path:line when applicable.
- One spec = one cohesive piece of work. If it grows past ~200 lines, split into numbered specs.

## Naming

Use the feature's noun/verb, not its acceptance criteria. Good: `worktree-detection.md`, `registry-locking.md`. Bad: `detect-git-worktrees-and-fallback-to-cwd.md`.
