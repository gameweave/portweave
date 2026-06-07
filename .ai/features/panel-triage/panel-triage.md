---
name: panel-triage
title: portweave panel — worktree triage, cleanup & quick actions
roadmap_ref: 'none — post-v0; the next iteration of the management-panel feature'
status: shipped # drafted | scoped | shipped | abandoned
---

# portweave panel — worktree triage, cleanup & quick actions

## Why

The shipped panel ([management-panel](../management-panel/management-panel.md))
answers _"what's allocated where"_ as a strictly read-only view. Living with it
surfaced the next two needs.

**Worktree sprawl is the painful one.** Developers — and coding agents — spin up
many git worktrees per repo; each carries its own `node_modules`/build output and
quietly eats gigabytes. Most outlive the PR that justified them, but it's hard to
tell _which_ are safe to delete, so they pile up. A real example from one machine:
7 worktrees of a single repo, **~20 GB**, of which 4 had already-merged-or-closed
PRs (several GB immediately reclaimable). The panel could _see_ all of them but
couldn't help you _act_. And you can't answer "is this worktree's work done?" from
local git alone — squash/rebase merges leave a branch's commits out of `main`'s
history (so `git branch --merged` misses them), and a closed-not-merged PR is
invisible locally. The reliable signal is the PR's state, which means asking
GitHub (via `gh`).

**The everyday preview is the smaller one.** Today a service is only a clickable
link if its config declares a matching `discoveryEnv` URL; a frontend dev server
with just a `PORT` env-var renders as a bare, un-clickable port. For "preview any
version" to feel one-click, every service should be a link.

This iteration turns the read-only viewer into a lightweight **triage + cleanup
surface** and tightens the preview UX. It enacts the "future management features"
that decision-log #37/#42 explicitly anticipated for the panel (All-OSS) — while
**respecting decision-log #34**: Portweave still never manages processes (no
start/stop). The genuinely new line it crosses is the first **registry write**
from the panel (pruning an allocation), which makes the security posture of an
unauthenticated loopback server a first-class concern.

Who benefits: anyone drowning in stale worktrees (reclaim disk by pruning the done
ones), and the everyday preview user (every service one click away, with the noise
collapsible).

## Parity rows

None. Like the panel it extends, this is a post-v0, Portweave-specific capability
that maps to no DESIGN.md §7.2 parity row. It builds on the §3 "Inspectable" goal
and the machine-wide-visibility lineage (§5.3), now adding _action_ on top of
visibility.

## Dependencies

- [management-panel](../management-panel/management-panel.md) — the shipped
  read-only panel this extends: its server, the `enrich` pipeline,
  project→worktree→service grouping, graceful degradation, and the
  `readRegistryEntries` non-pruning read.
- [registry-storage](../registry-storage/registry-storage.md) — the **prune**
  action writes the registry. That is the deliberate exception to the panel's
  read-only `readRegistryEntries` path (decision-log #44); it should reuse the
  existing locked read-modify-write + `remove(key)` primitive rather than
  hand-editing JSON.
- [worktree-context](../worktree-context/worktree-context.md) — the
  main-vs-linked-worktree distinction and per-worktree git state (branch,
  clean/dirty) build on the existing git worktree resolution.
- [config-loader](../config-loader/config-loader.md) — `projectName` already lives
  here (decision-log #45); the synthesized links reuse each service's allocated
  port.

## Gameweave reference

None — Gameweave surfaces allocations only through its dev wrapper and has no
panel; worktree-sprawl cleanup and PR-aware triage are generic dev-tooling needs,
not a Gameweave-specific pattern.

## Scope

This feature spans two loosely-coupled natures and will likely become **two
specs** under this folder: (A) read-only refinements to the existing panel, and
(B) write actions + worktree triage. Captured as one feature doc per request.

**In scope — A. Read-only refinements (no new security surface):**

- Every service renders as a clickable `http://localhost:<port>` link. When a
  service has an explicit `http(s)` `discoveryEnv` URL, use it; otherwise
  synthesize the localhost link. (Caveat: non-HTTP ports — databases, etc. —
  become harmless dead links; accepted for now over guessing which ports are
  browser-openable. The synthesized scheme is always `http`, so the link
  scheme-allowlist from decision-log #46 is satisfied by construction.)
- Projects and worktrees are collapsible, with collapse state persisted locally so
  a busy machine stays scannable.
- `projectName` grouping confirmed as-is: **group by `gitCommonDir`, label by
  `projectName`** (derived basename as fallback — already shipped, decision-log
  #45). Cross-repo name-merging is explicitly rejected (it would cluster unrelated
  repos that happen to share a name).

**In scope — B. Write actions + worktree triage/cleanup:**

- Per-worktree **git/PR status** (branch, and whether its PR is open / closed /
  merged) sourced from `gh`. **Optional, cached, and graceful**: if `gh` is missing
  or unauthenticated the panel still renders fully and simply omits PR state
  (mirroring the existing config-missing degraded path).
- The panel distinguishes the **main checkout from linked worktrees** and flags a
  worktree **safe to prune** only when it is a _linked_ worktree, its PR is
  merged/closed, **and** its working tree is clean. The main checkout is never
  flagged. (A merged worktree with uncommitted/untracked files is _not_ safe —
  this was observed in practice; never blind-force.)
- Each worktree shows its **on-disk size**.
- **Prune a worktree's Portweave allocation** from the panel, plus a headless
  **`portweave prune`** CLI command. This is the first registry write the panel
  performs.
- **Worktree directory removal**: the panel surfaces the exact `git worktree
remove` command to copy/run — it does **not** execute filesystem removal itself
  (at least initially).
- **Quick actions** at a worktree root: open a terminal, open in an editor, copy
  the path.
- A **security model for every write/mutating route**: `Origin`/`Host` checks, a
  CSRF token, and server-side confirmation for destructive actions — because the
  panel is an unauthenticated `127.0.0.1` server and a mutating route is reachable
  by any page open in the user's browser.

**Out of scope (deferred or rejected):**

- **Start/stop processes** — contradicts decision-log #34 (Portweave never manages
  processes) and the no-daemon design; Portweave doesn't even know a service's run
  command. Deferred indefinitely.
- **Executing `rm` / `git worktree remove` from the panel** — v1 surfaces the
  command instead; executing it (behind the security model + irreversibility
  guards) is a later step.
- **Cross-repo name grouping**, **non-GitHub PR providers** (GitLab/Bitbucket),
  and **auto-pruning without explicit user action**.

## Acceptance criteria sketch

- Every service row is a clickable link that opens `http://localhost:<its port>`;
  services with an explicit `http(s)` discovery URL use that URL, the rest use the
  synthesized one.
- Projects/worktrees can be collapsed and expanded, and the state survives a
  refresh.
- When `gh` is available and authenticated, each worktree shows its PR state
  (open/closed/merged); when `gh` is absent or unauthenticated, the panel still
  renders everything else with no error and no PR badges.
- A linked worktree whose PR is merged/closed **and** whose working tree is clean
  is marked "safe to prune"; the main checkout is never marked prunable; a merged
  worktree with uncommitted/untracked changes is **not** marked safe.
- Each worktree displays its disk size.
- Pruning a worktree (from the panel or via `portweave prune`) removes exactly that
  allocation from the registry and leaves all other entries unchanged;
  `portweave prune` works with the panel closed.
- Removing the directory is offered as a copyable `git worktree remove` command,
  not executed by the panel.
- A cross-origin or token-less request to any write route is rejected; destructive
  actions require explicit confirmation.

## Open questions

- **Spec split.** Confirm A (read-only refinements) and B (write actions + triage)
  become two separate specs under this feature's folder.
- **`gh` coupling.** Is a GitHub/`gh` dependency acceptable for an otherwise local,
  zero-config tool? Cache TTL, behavior on rate-limit, and on non-GitHub remotes?
- **Security model specifics.** Exact CSRF scheme (per-session token delivery,
  `Origin` allowlist, maybe a secret in the panel URL) and which actions require
  confirmation. Committing to panel writes likely warrants a decision-log entry
  revisiting the "panel never writes the registry" invariant (#44).
- **`portweave prune` scope.** Only reclaim the registry allocation, or also offer
  worktree-dir removal? How are targets selected (explicit path vs. a
  stale/merged-PR heuristic)?
- **Per-render cost.** Clean/dirty detection, PR state, and size each add work per
  worktree — what is cached, and what is the refresh model for the whole snapshot?
- **Cross-platform quick actions.** Which terminal/editor launchers per OS
  (macOS/Linux/Windows), and how are they configured or detected?
- **Directory removal.** Should the panel ever execute removal (with guards), or
  stay copy-the-command permanently?
