# `.ai/` — AI / agent collaboration artifacts

This directory holds the durable artifacts that AI agents, Claude Code, and human collaborators reference when working on Portweave. Files here aren't "documentation" in the user-facing sense — they're the project's internal source of truth for design, decisions, and in-flight specs.

## Layout

- **[DESIGN.md](./DESIGN.md)** — The design doc. Single source of truth for what Portweave is, why, and how it'll be built. Updated in place when the design shifts; section anchors are referenced from the decision log.
- **[decision-log.md](./decision-log.md)** — Append-mostly table of every meaningful design decision with rationale. When a decision is overturned, append a new dated note rather than rewriting history.
- **[specs/](./specs/)** — Implementation specs for individual features (one file per feature). See [specs/README.md](./specs/README.md) for conventions.
- **`sessions/`** _(runtime, gitignored)_ — Task-management session state. Created on demand by `npm run task:init -- --session <name>`.
- **`tool-results/`** _(runtime, gitignored)_ — Cached output from static-analysis tools, keyed by file hash. Created on demand by the cached-tool-runner.

## How agents should use this directory

1. **Before starting non-trivial work**, read DESIGN.md and decision-log.md to ground yourself in the current direction.
2. **For new features**, draft a spec in `specs/` via the `create-spec` skill before implementing (use `create-feature` for the composite flow).
3. **When you make a meaningful design decision** (architectural, naming, scope), append to decision-log.md. Reference the design doc section it relates to.
4. **Never write user-facing docs here.** Public README, contributor guide, etc. live at the repo root.
