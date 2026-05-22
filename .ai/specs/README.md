# Implementation specs

One file per feature, named `kebab-case-feature.md`. Created via the `create-spec` skill or by hand.

## Spec template

```markdown
# <Feature name>

**Status:** draft | approved | in-progress | shipped | abandoned
**Owner:** <name>
**Decision-log rows:** <comma-separated refs>

## Problem

What does this feature solve, and for whom? Why now?

## Approach

The recommended approach. Mention the major components and how they fit together.
Reference existing code by path:line where relevant.

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
5. **abandoned** — Decided not to build; keep the file with a brief note explaining why so the decision is reproducible.

## Naming

- Use the feature's noun/verb, not its acceptance criteria. `worktree-detection.md`, not `detect-git-worktrees-and-fallback-to-cwd.md`.
- Prefix dependent specs with a numeric prefix if order matters: `01-allocation-mechanism.md`, `02-registry.json`, `03-config-loader.md`.
