# `.ai/` — AI / agent collaboration artifacts

This directory holds the durable artifacts that AI agents, Claude Code, and human collaborators reference when working on Portweave. Files here aren't "documentation" in the user-facing sense — they're the project's internal source of truth for design, decisions, and in-flight specs.

## Layout

- **[DESIGN.md](./DESIGN.md)** — The design doc. Single source of truth for what Portweave is, why, and how it'll be built. Updated in place when the design shifts; section anchors are referenced from the decision log.
- **[decision-log.md](./decision-log.md)** — Append-mostly table of every meaningful design decision with rationale. When a decision is overturned, append a new dated note rather than rewriting history.
- **[roadmaps/](./roadmaps/)** — Upstream planning artifacts that decompose larger pushes (e.g. `v0-roadmap.md`) into feature-sized work. Optional — small features can skip the roadmap step.
- **[features/](./features/)** — Per-feature what/why documents at `<slug>/<slug>.md`. See [features/README.md](./features/README.md). Created via the `create-feature` skill.
- **[specs/](./specs/)** — Implementation specs at `<slug>/<slug>.md` (the _how_, one folder per feature). See [specs/README.md](./specs/README.md). Created via the `create-spec` skill.
- **`sessions/`** _(runtime, gitignored)_ — Task-management session state. Created on demand by `npm run task:init -- --session <name>`.
- **`tool-results/`** _(runtime, gitignored)_ — Cached output from static-analysis tools, keyed by file hash. Created on demand by the cached-tool-runner.

## How agents should use this directory

1. **Before starting non-trivial work**, read DESIGN.md and decision-log.md to ground yourself in the current direction.
2. **For new features**, draft the what/why in `features/` via `create-feature`, then the how in `specs/` via `create-spec`, then implement via `execute-spec`. Skip `create-feature` only if the feature's motivation is already obvious from a roadmap or an existing artifact.
3. **When you make a meaningful design decision** (architectural, naming, scope), append to decision-log.md. Reference the design doc section it relates to.
4. **Never write user-facing docs here.** Public README, contributor guide, etc. live at the repo root.

## Tracking feature work

Feature status lives in the `status:` frontmatter of each
`.ai/features/<slug>/<slug>.md`:

- `drafted` — feature doc exists; no spec yet (set by `create-feature`)
- `scoped` — spec exists (set by `create-spec` on the upstream feature doc)
- `shipped` — code merged, `npm run dev-workflow` green (set by `execute-spec`)
- `abandoned` — explicit decision not to build; the doc stays as a record

These three skills are the only things that should flip `status:`
automatically. If you change it by hand, do it intentionally.

### "What's next for `<roadmap>`?"

Features whose `roadmap_ref:` matches the roadmap, whose `status:` is not
`shipped` or `abandoned`, and whose `## Dependencies` are all `shipped`.
Order by the roadmap's own section sequence (or topologically by
dependencies when no roadmap ordering applies).

```bash
# All features tied to a given roadmap, with current status
for f in $(grep -l 'roadmap_ref: .ai/roadmaps/v0-roadmap.md' .ai/features/*/*.md); do
  printf '%s  %s\n' "$(grep '^status:' "$f" | head -1)" "$f"
done
```

Then read each non-`shipped` feature's `## Dependencies` section to find
the first one whose deps are all already `shipped`.

### "What's done?"

```bash
grep -l '^status: shipped$' .ai/features/*/*.md
```

### Features without a roadmap

`roadmap_ref:` is optional. A small one-off feature can omit it and still
be tracked — the `status:` field alone is enough.
