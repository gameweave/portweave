---
name: create-spec
description: Draft an implementation spec for a Portweave feature at .ai/specs/<slug>/<slug>.md. Use when the user wants to plan the implementation of a feature whose what/why is already captured in a feature doc (or alongside drafting one). Follows Portweave's spec template (Problem / Approach / Acceptance criteria / Open questions).
---

# create-spec

## When to invoke

Trigger when the user signals "let's spec out X" or "draft a spec for Y" or
"before we build this, let's write it down" — anything that suggests they
want the _how_ captured before code lands.

Do NOT trigger for:

- Trivial fixes / typo corrections
- Refactors with no behavior change
- Tasks the user wants to just-do-now
- Capturing the **what/why** of a feature — that's the `create-feature`
  skill, which writes `.ai/features/<slug>/<slug>.md`

## What to produce

A single markdown file at `.ai/specs/<slug>/<slug>.md` following the template
in [.ai/specs/README.md](../../../.ai/specs/README.md). Create the
`.ai/specs/<slug>/` directory if missing.

Required header fields:

1. **Status** (always starts as `draft`)
2. **Owner** (user-provided or "TBD")
3. **Feature doc** — link back to `.ai/features/<slug>/<slug>.md` if one
   exists (and if it doesn't, gently suggest writing one via `create-feature`
   before drafting the spec)
4. **Decision-log rows** (cross-reference to `.ai/decision-log.md` if
   applicable)

Required sections:

5. **Problem** — what does this solve, for whom, why now
6. **Approach** — concrete recommended approach with file paths / code
   references
7. **Acceptance criteria** — checklist of verifiable conditions
8. **Open questions** — anything blocking implementation

## How to drive the conversation

1. **Read [.ai/DESIGN.md](../../../.ai/DESIGN.md)** first so the spec aligns
   with the resolved design decisions.
2. **Read the feature doc** at `.ai/features/<slug>/<slug>.md` if one exists.
   The spec turns its acceptance-criteria sketches and open questions into
   concrete plans.
3. Confirm with the user: feature name, scope boundaries, and which §7.2
   parity row this maps to (if any).
4. Identify which boardflip reference files in
   [reference/boardflip/](../../../reference/) are relevant. Cite their
   patterns.
5. Draft the spec. Lean on existing decisions from `.ai/decision-log.md`
   rather than re-litigating.
6. Resolve the feature doc's open questions where possible. Surface any
   remaining genuine open questions in §Open questions rather than papering
   them over.
7. **Update the upstream feature doc's frontmatter:** set
   `status: scoped`. This signals the feature has moved from "what/why
   captured" to "how planned." If no feature doc exists (rare — the spec
   is the first artifact for this feature), skip this step.
8. After writing, ask the user to review and confirm `Status: approved`
   before any code lands. Implementation goes through `execute-spec`.

## Quality bar

- Acceptance criteria must be _verifiable without asking the spec author_.
  Bad: "registry is robust." Good: "concurrent invocations from N processes
  never produce overlapping allocations (verified via integration test under
  `src/__tests__/registry.concurrent.test.ts`)."
- Approach should reference existing code
  (`reference/boardflip/scripts/src/utils/...`) by path:line when applicable.
- One spec = one cohesive piece of work. If it grows past ~200 lines, split
  into numbered sub-specs inside the same folder
  (`.ai/specs/<slug>/01-foo.md`, `.ai/specs/<slug>/02-bar.md`) and keep the
  top-level `<slug>.md` as the index.

## Naming

Use the feature's noun/verb, not its acceptance criteria. Good:
`worktree-context.md`, `registry-storage.md`. Bad:
`detect-git-worktrees-and-fallback-to-cwd.md`. The spec folder and file
name match the upstream feature doc's slug:
`.ai/specs/<slug>/<slug>.md` ↔ `.ai/features/<slug>/<slug>.md`.
