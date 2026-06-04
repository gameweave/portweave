---
name: management-panel
title: portweave panel preview dashboard
roadmap_ref: 'none — post-v0; reframes the DESIGN.md §3 "Web UI / dashboard" non-goal'
status: shipped # drafted | scoped | shipped | abandoned
---

# portweave panel preview dashboard

## Why

The machine-wide pool buys conflict-free ports, but it pays for them in
_visibility_: the ports are now dynamic, so a developer can no longer assume
the API is on `3001` or bookmark `localhost:5173` for a feature worktree —
today it might be `30002`, tomorrow `30107`. The more the model succeeds
(several projects, several worktrees, agents each spinning up their own dev
stack), the harder it becomes to answer the most basic question: _what's
running where, and what URL do I open to preview it?_

`portweave show` (DESIGN.md §5.2) answers that for **one** worktree, one
invocation at a time. It does not answer the cross-cutting version: stand back
and see _everything_ allocated on this machine at once. DESIGN.md already
gestures at this — §3 lists "Inspectable" as a goal ("allocations are knowable
without running anything") and §5.3 notes that "`portweave list` (future) can
show every project on the machine in one place." The panel is the
low-friction, visual realization of that idea: instead of grepping
`registry.json` or running `show` per directory, you open one page and click.

The motivating moment is the request that prompted this feature: _"I want to
easily preview any version of my projects, even when the ports are dynamic."_
The panel gives a stable home page of clickable, labeled preview links —
grouped by project → worktree → service — so previewing any running version is
one click, not a port hunt. A liveness indicator distinguishes an active
preview from a stale allocation at a glance.

Who benefits: solo developers juggling repos; anyone running parallel worktree
dev stacks; and humans supervising coding agents that bring up many dev
servers, who want to glance at what's currently live.

This deliberately revisits the §3 non-goal "**Web UI / dashboard.** CLI only at
v0." That was a v0 _scope cap_, not a permanent stance — v0 has shipped. We
reopen it narrowly as a **read-only viewer** (not the full management dashboard
the original non-goal connoted), positioned **All-OSS**. The reframing is
recorded in the decision log. (The adjacent "local DNS" idea — resolving
`api.foo.dev` to the right port — is deferred: it's heavier and we'd rather
learn from how people use the panel first.)

## Parity rows

None. The §7.2 parity rows define the Gameweave drop-in surface, which v0 has
already shipped; the panel is a post-v0, Portweave-specific addition that maps
to no parity row. It does extend the §3 "Inspectable" goal and §2 use case #5
("what port is the API on right now?") from a single worktree to the whole
machine, and realizes the machine-wide-visibility intent §5.3 reserved for a
future `portweave list`.

## Dependencies

- [registry-storage](../registry-storage/registry-storage.md) — supplies the
  read of the machine-wide registry: every worktree's allocation key, namespace,
  per-service port map, and recency timestamp. The panel is a pure reader over
  this; it never claims, prunes, or rewrites.
- [config-loader](../config-loader/config-loader.md) — provides each worktree's
  normalized service inventory so every port can be labeled with its declared
  service name and env-var, and grouped services render together. Loaded
  per-worktree from the path the registry records.
- [env-resolution](../env-resolution/env-resolution.md) — resolves a worktree's
  `discoveryEnv` templates into the concrete `http://localhost:<port>` URLs the
  panel turns into clickable links, so the panel, `show`, and `run` present
  structurally identical views of the same allocation.
- [library-runtime](../library-runtime/library-runtime.md) — the programmatic
  entry the panel server reuses to resolve a worktree's env in-process, rather
  than shelling out to the CLI per entry. The allocation key shape it consumes
  comes from [worktree-context](../worktree-context/worktree-context.md).

## Gameweave reference

None — Gameweave surfaces allocations only through its dev wrapper or direct
registry inspection; it has no dashboard. The panel is Portweave-specific.

## Scope

**In scope (POC):**

- A `portweave panel` subcommand that starts a local, **read-only** web server
  bound to loopback only, prints its URL, and runs in the foreground until the
  user interrupts it — an on-demand viewer the user starts and stops, not a
  background process (consistent with the no-daemon design, DESIGN.md §5.6).
- A single page listing every allocation in the machine-wide registry, grouped
  **project → worktree → service**.
- Each service rendered with its config-derived label and env-var, and its
  resolved discovery URL as a clickable link that opens the running service.
  Services with no URL template show a non-clickable port chip — still useful.
- A per-port **liveness indicator**: whether something is currently listening
  (an on-demand probe at render time), so a live preview is distinguishable
  from a stale allocation.
- **Graceful degradation**: a worktree whose config is missing or whose
  directory has been deleted still renders from raw registry data (ports +
  paths) with a clear "stale/degraded" marker. One broken entry never breaks
  the page.
- A simple **dark theme** and a manual refresh that re-reads current state.
- A strict no-mutation contract: the panel never writes the registry (modulo
  any recency bump the storage layer applies on read).
- **No new runtime dependency** in the published package: the server uses the
  platform's built-in HTTP, and the UI ships as pre-built static assets.

**Out of scope (POC / deferred):**

- Any **management/mutation** action from the UI — kill a process, release or
  re-allocate ports, prune stale entries, rename. These are the "possible
  future management features"; the POC is view-only.
- Live push updates (WebSocket/SSE) or background auto-refresh; the POC
  re-reads on manual refresh.
- Auth, TLS, non-loopback binding, multi-user or remote access.
- Cross-machine views — each machine has its own registry (§3: no multi-machine
  sync).
- A light theme or theming options.
- Process management or naming — still out of scope per decision-log #34; the
  panel _reports_ liveness, it does not own processes.
- Local DNS / hostname routing — a separate, deferred idea.

## Acceptance criteria sketch

- With allocations present for several worktrees, `portweave panel` starts a
  server on a loopback address, prints the URL, and stays in the foreground;
  opening that URL shows every registry allocation grouped project → worktree →
  service.
- Each service that has a discovery URL renders as a link that opens the
  running service; services without a URL template still display their port.
- A port that currently has a listener is visibly marked "live"; one with no
  listener is marked "not running" — so an active preview is distinguishable
  from a stale allocation without leaving the page.
- A worktree whose config file is missing, or whose directory has been deleted,
  still appears — rendered from raw registry data with a clear degraded marker.
  The page loads even when one entry is broken.
- Loading and refreshing the page repeatedly leaves the registry's allocation
  entries unchanged: no claims, prunes, or rewrites occur as a side effect of
  viewing.
- Interrupting the command (Ctrl-C) shuts the server down cleanly and returns
  the terminal prompt.
- With an empty registry, the page loads and shows a clear empty state rather
  than erroring.
- Installing the package adds no new runtime dependency beyond what v0 already
  ships; the panel's UI is served as static assets.

## Open questions

- **Project labeling.** The only repo-stable identity across worktrees is the
  git common dir (a `.git`-ish path), and there is no project-name field in the
  config today. Is a derived label (repo directory basename) good enough for the
  POC, or do we add an optional project name to the config schema?
- **Panel port.** A fixed, memorable default with a `--port` override is the
  current lean — but what value, and what happens when that port is already
  bound (clear error vs. auto-pick another)?
- **Liveness semantics.** A positive probe means "something is listening," not
  "the right service is healthy." Is the bound/not-bound signal the right POC
  granularity, and what probe timeout balances responsiveness against false
  "not running" results on a slow service?
- **Refresh model.** Manual refresh button vs. a periodic client poll for the
  POC (live push is deferred regardless).
- **Future management boundary.** Positioning is All-OSS today, but if/when
  mutation features land, which (if any) stay free vs. move to a paid tier is
  unresolved — and informs how much affordance the read-only POC should hint at.
