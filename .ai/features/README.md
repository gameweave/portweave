# Feature documents

Per-feature **what/why** documents. One folder per feature so each can hold
supporting files (research notes, diagrams, sub-docs) alongside the canonical
entry.

## Where things live

```
.ai/features/<slug>/<slug>.md   # canonical feature doc (this directory)
.ai/specs/<slug>/<slug>.md      # implementation spec — the "how"
src/...                          # eventual implementation
```

Feature docs are upstream of specs. They capture motivation and observable
behavior, not file paths or function signatures. The future
[create-spec](../../.claude/skills/create-spec/SKILL.md) skill turns a feature
doc into an implementation spec.

## Feature-doc template

Place at `.ai/features/<slug>/<slug>.md`:

```markdown
---
name: <kebab-case slug>
title: <Feature name>
roadmap_ref: .ai/roadmaps/v0-roadmap.md#<feature-anchor>
status: drafted # drafted | scoped | shipped | abandoned
---

# <Feature name>

## Why

Plain-English motivation. What does this enable that's not possible without
it? Who benefits?

## Parity rows

DESIGN.md §7.2 row numbers (if any). Cross-link to the specific design
sections this feature satisfies.

## Dependencies

Bulleted links to upstream feature docs:

- [other-feature](../other-feature/other-feature.md)

## Boardflip reference

Read-only files in `reference/boardflip/` that inspire the shape. Never
imported at runtime.

## Scope

What this feature includes at v0. What it explicitly does NOT include.

## Acceptance criteria sketch

Observable behaviors the future spec will turn into testable criteria.

## Open questions

Transcribed from the roadmap or surfaced while drafting. Resolved later
during `/create-spec`.
```

## Lifecycle

1. **drafted** — Created via `create-feature` or by hand. The what/why is
   captured but no spec exists yet.
2. **scoped** — A spec exists at `.ai/specs/<slug>/<slug>.md`. The feature
   has moved from "what/why" to "how".
3. **shipped** — Implementation merged.
4. **abandoned** — Decided not to build. Keep the file with a brief
   explanation so the decision is reproducible.

## Naming

- Use the feature's noun/verb, not its acceptance criteria.
  `worktree-context.md`, not `detect-git-worktrees-and-fallback-to-cwd.md`.
- Folder name and inside-file name match: `port-allocator/port-allocator.md`.
- Slug stays kebab-case throughout.
