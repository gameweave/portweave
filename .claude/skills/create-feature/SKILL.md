---
name: create-feature
description: Draft a per-feature what/why document at .ai/features/<slug>/<slug>.md. Use when the user wants to define a new feature's motivation and scope before writing a spec. Stops at the feature doc — implementation specs and code are separate skills (create-spec, execute-spec).
---

# create-feature

## When to invoke

Trigger when the user wants to capture the **what and why** of a new feature
before any implementation planning. Examples:

- "Let's add a feature for live conflict detection"
- "Document the worktree-context feature"
- "Create a feature doc for X"
- "Add feature X" (default to a feature doc unless the user explicitly wants a
  spec or implementation)

If the user wants the implementation plan, route to `create-spec` instead.
If the user wants to ship the implementation, route to `execute-spec`.

## What to produce

A single markdown file at `.ai/features/<slug>/<slug>.md` following the
template in [.ai/features/README.md](../../../.ai/features/README.md).

Required frontmatter:

- `name`: kebab-case slug
- `title`: human-readable feature name
- `roadmap_ref`: link back to the roadmap section if one exists
- `status`: always starts as `drafted`

Required sections:

1. **Why** — plain-English motivation, beneficiaries
2. **Parity rows** — DESIGN.md §7.2 row numbers, if applicable
3. **Dependencies** — links to upstream feature docs
4. **Boardflip reference** — relevant files in `reference/boardflip/`
5. **Scope** — what's in / what's out at v0
6. **Acceptance criteria sketch** — observable behaviors (not test code)
7. **Open questions** — items that need resolving during the spec phase

## How to drive the conversation

1. **Read [.ai/DESIGN.md](../../../.ai/DESIGN.md)** so the feature doc aligns
   with the resolved design decisions.
2. Confirm with the user (or infer from the roadmap section if one is
   supplied): feature name, slug, scope boundaries, parity row mapping.
3. Identify which boardflip reference files in
   [reference/boardflip/](../../../reference/) inspire the shape. Cite their
   patterns without proposing concrete implementation details.
4. Create the directory `.ai/features/<slug>/` if missing, then write
   `.ai/features/<slug>/<slug>.md`.
5. Lean on existing decisions from `.ai/decision-log.md` rather than
   re-litigating.
6. Transcribe open questions rather than resolving them — they belong in the
   spec phase.

## Quality bar

- The "Why" section reads as motivation, not implementation detail. Bad:
  "loads `portweave.config.json` with zod." Good: "users get conflict-free
  ports across multiple worktrees without manually wiring up env vars."
- Acceptance-criteria sketches describe **observable behavior**, not file
  paths or function signatures. Those live in the spec.
- Open questions stay open. The point of this skill is to capture what we
  don't yet know, not paper over it.
- One feature doc = one cohesive capability. If the doc grows past
  ~150 lines, the feature is probably two features.

## Naming

Use the feature's noun/verb, not its acceptance criteria. Good:
`worktree-context.md`, `port-allocator.md`. Bad:
`detect-git-worktrees-and-fallback-to-cwd.md`. The folder and inside-file
name match: `.ai/features/<slug>/<slug>.md`.

## What this skill does NOT do

- Write or edit any code under `src/`, `scripts/`, or `config/`
- Create or modify spec documents under `.ai/specs/`
- Run `npm run dev-workflow`
- Update `.ai/decision-log.md`
- Bypass into spec or implementation flow — if the user asks for those, route
  to `create-spec` or `execute-spec` after the feature doc lands

Spec drafting and implementation are deliberately separate skills so the
feature doc can be reviewed and iterated on its own.
