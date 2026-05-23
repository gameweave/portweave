---
name: worktree-context
title: Worktree context, namespace derivation, and overrides
roadmap_ref: .ai/roadmaps/v0-roadmap.md#3-worktree-context--git-detection-namespace-derivation-manual-overrides
status: scoped
---

# Worktree context, namespace derivation, and overrides

## Why

Every Portweave allocation needs a stable identity for "this project, this
worktree, right now" — and that identity has to survive across restarts,
across terminals, and across parallel coding agents working in sibling
worktrees of the same repo. Without it, two worktrees of the same project
can't coexist (they'd both claim the same registry key and collide), and
reruns from the same worktree would lose their port stickiness (the dev
server comes up on a different port every time, breaking browser bookmarks
and saved devtools sessions).

The worktree-context layer is what makes the rest of Portweave possible. It
answers three questions for every other feature downstream:

1. _Where am I?_ — git worktree root, or absolute cwd when there's no repo.
2. _What is this worktree's name?_ — `main` at the primary worktree, a
   deterministic slug-hash for feature worktrees, or whatever the developer
   pinned with an env override.
3. _What key should the registry use to find my allocation?_ — a stable
   tuple combining the git common dir (so all worktrees of one repo share a
   namespace family) and this worktree's root path.

This is the stickiness contract from DESIGN.md §5.4 made concrete: same
worktree → same key → same ports across restarts; different worktrees of the
same repo → different keys → different ports; non-git directories still get
keyed in a sensible way so the tool works outside of git, too.

## Parity rows

DESIGN.md §7.2:

- **Row 3** — Git worktree detection (`git rev-parse`, `git worktree list`)
- **Row 4** — Namespace derivation (`main` vs. feature-slug-hash)
- **Row 8** — Explicit manual override via env vars (`PORTWEAVE_NAMESPACE`,
  `PORTWEAVE_OFFSET`)

Also load-bearing for §5.4 (Keying — per-worktree path), which is the
stickiness invariant the whole allocator relies on.

## Dependencies

- [result-types](../result-types/result-types.md) — git-CLI invocation,
  namespace parsing, and env-override validation all have expected failure
  modes (not a git repo, invalid offset literal, unparseable `worktree list`
  output). They surface as `Result<T, E>` values using the shared primitive,
  not ad-hoc throws.

## Boardflip reference

Read-only files in `reference/boardflip/` that inspire the shape. Never
imported at runtime.

- [reference/boardflip/scripts/src/utils/worktree-context-git.ts](../../../reference/boardflip/scripts/src/utils/worktree-context-git.ts)
  — inspires the git-CLI shell-out shape: `git rev-parse --show-toplevel`,
  `git rev-parse --git-common-dir`, `git worktree list --porcelain`, with a
  scrubbed `GIT_*` environment so a parent process's git state doesn't leak
  in. Also models the `null`-on-failure convention for "this isn't a git
  repo."
- [reference/boardflip/scripts/src/utils/worktree-context-namespace.ts](../../../reference/boardflip/scripts/src/utils/worktree-context-namespace.ts)
  — inspires the namespace shape: `"main"` when the current root equals the
  main worktree root, otherwise `<slugified-branch>-<8-char-hash>`. Also
  models the env-override pattern (literal validation, sanitization, max
  length) that Portweave reuses with `PORTWEAVE_*` env-var names.

## Scope

**In scope (v0):**

- Detect git worktree context for a given cwd: returns the current worktree
  root, the git common dir, the main worktree root, and the list of all
  worktree roots — or signals "not a git repo" cleanly so a fallback path
  can take over.
- Non-git fallback: use the absolute `cwd` as the allocation key so
  Portweave still works outside of git checkouts.
- Derive a namespace from the detected context: `"main"` when the current
  root is the main worktree root, otherwise a deterministic
  `<slugified-branch>-<8-char-hash>` derived from the worktree's basename
  and absolute path.
- Honor the `PORTWEAVE_NAMESPACE` and `PORTWEAVE_OFFSET` env vars as
  explicit manual overrides (DESIGN.md §7.2 row 8), validated and sanitized
  the same way boardflip's overrides are.
- Compose an `AllocationKey` value combining the git common dir (or `null`),
  the worktree root, and the resolved namespace — this is the stable
  identity downstream features (registry, allocator) use to find or claim a
  block.
- Tests run real `git init` against `os.tmpdir()` directories rather than
  mocking the git CLI, so the behavior reflects what real git does on the
  developer's machine.

**Out of scope (v0):**

- Watching the registry or worktree list for changes — every invocation
  re-detects from scratch (consistent with the stateless, no-daemon design
  in DESIGN.md §5.6).
- Caching git output across CLI runs. Each Portweave invocation pays the
  cost of running git once; that's fine for a one-shot CLI.
- Branch-name detection or any awareness of the _content_ of a worktree
  beyond its root path. Slug derivation uses the worktree's basename, not
  the branch name, matching boardflip's shape.
- Cross-machine identity. Worktree context is local-only; sync across
  machines is a future roadmap item.

## Acceptance criteria sketch

- Against a real temp repo created with `git init`, detection correctly
  identifies the main worktree root, the git common dir, and the list of
  worktree roots from a cwd anywhere inside the repo.
- Against a feature worktree (`git worktree add`), detection returns the
  feature worktree's root as the current root and the original repo as the
  main root.
- Against a directory that is not a git repo, detection signals "not a git
  repo" so the caller can fall through to the absolute-cwd fallback path.
- Namespace derivation returns `"main"` exactly when the current root equals
  the main root.
- Namespace derivation for a feature worktree is deterministic: the same
  worktree path produces the same namespace across runs, processes, and
  restarts of the machine.
- Setting `PORTWEAVE_NAMESPACE` overrides the derived namespace; the
  override is sanitized to the same character set the derived value uses.
- Setting `PORTWEAVE_OFFSET` to a valid integer literal overrides the
  numeric offset; an invalid literal surfaces a typed failure rather than a
  silent fallback.
- The composed `AllocationKey` for a given worktree path is byte-identical
  across restarts (this is the stickiness contract per DESIGN.md §5.4).
- Two different worktrees of the same repo produce different
  `AllocationKey` values.

## Open questions

- Hash format: boardflip uses 8-char hash of absolute path. Match exactly,
  or upgrade to a longer/different scheme? Recommend **match boardflip** for
  migration debugging parity.
