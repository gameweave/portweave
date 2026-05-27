# Implementation specs

Per-feature **how** documents. One folder per spec so each can hold
supporting files (diagrams, research, sub-specs) alongside the canonical
entry.

Specs live at `.ai/specs/<slug>/<slug>.md`. Supporting files may live
alongside as `.ai/specs/<slug>/*.md` or other extensions.

Specs are downstream of [feature documents](../features/README.md): the
feature doc captures _what/why_, the spec captures _how_. Authored via the
[create-spec](../../.claude/skills/create-spec/SKILL.md) skill or by hand.

## Spec template

Place at `.ai/specs/<slug>/<slug>.md`:

```markdown
# <Feature name>

**Status:** draft | approved | in-progress | shipped | abandoned
**Owner:** <name>
**Feature doc:** [.ai/features/<slug>/<slug>.md](../../features/<slug>/<slug>.md)
**Decision-log rows:** <comma-separated refs>

## Problem

What does this feature solve, and for whom? Why now?

## Approach

The recommended approach. Mention the major components and how they fit
together. Reference existing code by path:line where relevant.

## Acceptance criteria

- [ ] Concrete, verifiable conditions
- [ ] Each one should be checkable without running the spec author down

## Open questions

Anything that needs to be resolved before implementation can proceed.
```

## Lifecycle

1. **draft** — Created via `create-spec` or by hand. Iteration happens here.
2. **approved** — User has signed off. Implementation can begin.
3. **in-progress** — Active implementation. Use `execute-spec` to drive it.
4. **shipped** — Merged and verified.
5. **abandoned** — Decided not to build; keep the file with a brief note
   explaining why so the decision is reproducible.

## Naming

- Use the feature's noun/verb, not its acceptance criteria.
  `worktree-context.md`, not `detect-git-worktrees-and-fallback-to-cwd.md`.
- Folder name and inside-file name match the feature-doc slug:
  `.ai/specs/port-allocator/port-allocator.md` corresponds to
  `.ai/features/port-allocator/port-allocator.md`.
- Prefix dependent specs with a numeric prefix if order matters within a
  single feature's folder: `port-allocator/01-allocation-mechanism.md`,
  `port-allocator/02-stress-tests.md`.
