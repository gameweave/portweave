---
name: create-feature
description: End-to-end composite skill for shipping a new Portweave feature — drafts the spec, gets approval, then implements. Use when the user says "add feature X" or "let's ship X" without first writing a spec. Delegates to create-spec for the spec draft and execute-spec for implementation.
---

# create-feature

## When to invoke

Trigger when the user wants a feature shipped end-to-end and hasn't separately invoked `create-spec` or `execute-spec`. Examples:

- "Let's add live conflict detection to Portweave"
- "Ship the worktree-detection feature"
- "Build X"

If the user has already written a spec, route directly to `execute-spec` instead.
If the user only wants the spec (no implementation yet), route to `create-spec`.

## Procedure

This is a thin orchestrator over the two underlying skills:

### Phase 1 — Spec (via create-spec)

1. Invoke `create-spec` with the user's feature description.
2. Draft the spec under `.ai/specs/<kebab-case-feature>.md`.
3. **Hand back to the user for review.** Do not proceed without explicit approval.

### Phase 2 — Implementation (via execute-spec)

4. Once the user marks the spec `Status: approved`, invoke `execute-spec`.
5. Follow the full execute-spec procedure (tests first, dev-workflow gate, status update on ship).

## Approval gate (critical)

Never bypass the user's approval between phases. The point of the spec is to align _before_ code lands. If the user pushes back on the spec, iterate in Phase 1 — do not start implementation with unresolved questions.

## When to break out of the composite

- If the user redirects mid-spec ("actually, let's just hack this in"), route to direct implementation without a spec. Sometimes a feature genuinely doesn't warrant the ceremony — defer to the user.
- If the spec reveals the feature is much bigger than expected, surface that explicitly and offer to split into multiple specs (numbered: `01-foo.md`, `02-bar.md`).
- If acceptance criteria can't be made verifiable, stop. A feature that can't be verified can't be shipped.
