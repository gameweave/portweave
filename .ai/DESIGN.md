# Portweave — Design Document

> **Name:** Portweave (published under the Gameweave organization as OSS)
> **Status:** Pre-v0 design doc
> **Authors:** Jonathan + Claude (brainstorm), 2026-05-22

---

## 1. Problem Statement

A decade ago, a developer typically worked on one project at a time. Hard-coding `localhost:3000` for the dev server and `localhost:8000` for the database was fine — friction was tolerable because there was one project per shell session per day.

That world is gone.

Today's developer routinely has:

- Multiple projects open simultaneously (frontend + backend + a sandbox)
- Multiple git worktrees of the same project, each running its own dev stack so feature branches don't disturb `main`
- Multiple coding agents working in parallel worktrees, each spinning up its own dev server to run e2e tests and verification loops as part of guardrails

Static verification (running real dev servers + e2e tests during agent work) is becoming the dominant pattern for high-quality agent output. The 1–3 year prediction: this becomes standard practice across all serious development workflows, not just advanced ones.

Every one of these scenarios needs a unique set of ports. Today, developers solve this manually — bespoke `.env.local` files, hand-tuned offset conventions, hardcoded "worktree A uses 3001, worktree B uses 3101" rules. Each project re-invents the wheel. Boardflip (the codebase that prompted this doc) has built a sophisticated worktree-aware port allocation system; most other projects haven't, and even boardflip's system only solves _within-project_ collisions, not the case of two different projects trying to bind port 5173 on the same machine.

**The thesis:** port allocation for local development should be a zero-thought operation that just works across N projects and N worktrees, with no manual configuration after one-time setup per project.

---

## 2. Target Users & Use Cases

### Primary users

- **Solo developers juggling multiple repos.** Wants `pnpm dev` in any repo to "just work" without thinking about which port collides with what.
- **Developers using git worktrees for parallel feature work.** Wants worktree A's dev server, worktree B's dev server, and `main`'s dev server to all run simultaneously without manual port overrides.
- **AI coding agents running verification loops.** Each agent spawns its own dev server / API / DB to verify its changes. Agent author wants this to happen without writing port-allocation logic in every project template.
- **Small teams sharing a dev machine** (rare but real, e.g. pair programming over a shared remote dev host).

### Use cases

1. `cd ~/projects/foo && pnpm dev` — first run allocates ports, every subsequent run reuses them. Same ports across restarts so devtools/browser bookmarks stay valid.
2. `git worktree add ../foo-feature feature-x && cd ../foo-feature && pnpm dev` — gets a _different_ block of ports automatically, no manual setup.
3. Agent in worktree spawns `pnpm test:e2e` in a subshell — picks up the _same_ ports as the running dev server in that worktree (so tests hit the right place).
4. `cd ~/projects/bar && pnpm dev` while foo is running — gets a non-colliding block even though foo and bar both default to Vite on 5173.
5. Developer wants to know "what port is the API on right now in this worktree?" — runs `portweave show` and gets the answer.

---

## 3. Goals & Non-Goals

### Goals

- **Zero-config UX after one-time setup.** Developer adds `portweave.config.json` (or equivalent) once per project, then never thinks about ports.
- **Language-agnostic.** Primary interface is a CLI; works for JS, Python, Rust, Go, anything.
- **Stable per worktree.** Same worktree → same ports across restarts.
- **Machine-wide collision-free.** No two simultaneously-running projects on the same machine ever get overlapping port blocks.
- **Drop-in replaceable for hand-rolled systems.** Specifically, boardflip's existing worktree-port system can be removed and replaced with portweave on day one of v0 shipping, with no user-visible behavioral regression.
- **Inspectable.** Registry is a human-readable JSON file; allocations are knowable without running anything.

### Non-Goals (for v0)

- **Production port management.** This is for local dev only.
- **Secret rotation, credential management.** Out of scope.
- **Multi-machine sync.** Each machine has its own registry.
- **Framework-specific magic** (auto-knowing what Next.js needs without config). Maybe a v2 polish via an adapter layer.
- **Docker Compose / devcontainer port-forwarding management.** Compose users can `source .portweave/current.env`; full integration is a v2+ topic.
- **Web UI / dashboard.** CLI only at v0.

---

## 4. Prior Art

The reference implementation is **boardflip's worktree-port system**, captured in this repo at [reference/boardflip/](../reference/boardflip/). It already solves ~80% of this problem for one project, and inspecting it reveals the real-world edges (lock contention, dual-port services, stale registry entries). The OSS project is essentially "extract this pattern, generalize the project-specific naming, replace the per-project offset formula with a machine-wide pool, and harden it."

Key files (read-only snapshot in this repo; see [reference/MANIFEST.md](../reference/MANIFEST.md)):

- [reference/boardflip/packages/shared/src/worktree-ports.ts](../reference/boardflip/packages/shared/src/worktree-ports.ts) — `base + offset*100` formula for 8 services
- [reference/boardflip/scripts/src/utils/worktree-context-registry.ts](../reference/boardflip/scripts/src/utils/worktree-context-registry.ts) — JSON registry in `.git/`, directory-mutex locking, stale-lock cleanup, auto-pruning
- [reference/boardflip/scripts/src/utils/worktree-context-git.ts](../reference/boardflip/scripts/src/utils/worktree-context-git.ts) — git worktree detection
- [reference/boardflip/scripts/src/utils/worktree-context-namespace.ts](../reference/boardflip/scripts/src/utils/worktree-context-namespace.ts) — namespace derivation (main vs. feature-slug-hash) and env-var override
- [reference/boardflip/scripts/src/utils/apply-worktree-env.ts](../reference/boardflip/scripts/src/utils/apply-worktree-env.ts) — env injection + URL construction for service discovery
- [reference/boardflip/ecosystem.config.cjs](../reference/boardflip/ecosystem.config.cjs) — PM2 process naming per worktree

What generalizes cleanly:

- Worktree detection logic
- File-locked JSON registry pattern
- Env-var injection
- Service discovery via URL templates

What needs to change:

- Project-specific naming (`gameweave-*`, `GAMEWEAVE_*`) → generic prefixes (`PORTWEAVE_*`)
- Per-project offset formula (`+offset*100`) → machine-wide pool block allocation (this is the key model change)
- 99-offset cap → no cap (machine-wide pool handles arbitrarily many worktrees)
- Service definitions hardcoded in `ports.ts` → declared in user's `portweave.config.json`

---

## 5. Design Decisions (Resolved)

### 5.1 Allocation model — machine-wide pool

Portweave maintains a single global registry per machine. Each worktree gets a contiguous block of ports allocated from a free pool.

**Why not boardflip's per-project offset model?** It's simpler at the per-project level but doesn't compose: two projects on the same machine both default to Vite 5173, both get "offset 0" in their respective registries, both bind to 5173 and collide. The machine-wide pool collapses both projects' allocations into one address space.

**Why not hybrid (prefer configured ports, else free)?** Considered. Better UX in principle — your boardflip dev server stays at the familiar 3001 — but at the cost of non-determinism: "is the API on 3001 or 31xx today?" The pure machine-wide-pool model is more predictable: you always get _some_ unique port, never the "preferred" one. Worth revisiting in v1 once we see real friction.

### 5.2 Consumption — wrapper CLI primary, `.env` file as side effect

Primary interface: `portweave run -- pnpm dev`. The wrapper allocates a port block, injects env vars (`API_PORT=...`, `VITE_PORT=...`, etc.) into the child process, and runs the command.

**Side effect:** every invocation also writes `.portweave/current.env` (gitignored) containing the same allocation. This covers cases where the wrapper alone fails:

- **Docker Compose** doesn't inherit env vars from the wrapper; reads `.env` automatically via `env_file:`
- **IDE run configurations** launch commands directly without the wrapper prefix
- **Vite/Next config files** load ports at config-eval time, before any wrapper child runs — sourcing `.portweave/current.env` into the shell first solves this
- **Already-running process introspection** — `cat .portweave/current.env` answers "what's my API port right now?" without any tool invocation

Both consumption modes work from the same code path; no extra implementation cost.

A `portweave show` subcommand prints the current allocation for the cwd's worktree without running anything.

### 5.3 Registry location — `~/.config/portweave/registry.json`

XDG-standard user-scoped path. Single-user, machine-wide visibility. `portweave list` (future) can show every project on the machine in one place. Doesn't pollute project directories or `.git/`.

### 5.4 Keying — per-worktree path

Allocations are keyed on `(git common-dir, worktree path)` for git-managed projects; falls back to absolute cwd for non-git directories. This ensures:

- Same worktree → same ports across restarts (sticky)
- Different worktrees of the same repo → different ports (no collision)
- `pnpm dev` and `pnpm test:e2e` from the same worktree in different terminals → same ports (so tests hit the dev server)

### 5.5 Form factor — npm package with CLI binary

Distributed via npm; primary interface is a CLI executable. Not a pnpm-only plugin — that would shrink audience for no upside, since the tool benefits Python/Rust/Go projects equally.

A typed JS library import API (`import { ports } from 'portweave/runtime'`) is **deferred to post-v0**. Useful for Vite config files specifically, but not required for parity with boardflip.

### 5.6 Architecture — stateless, file-locked, no daemon

The CLI is a one-shot process. Coordination happens through the registry file with directory-mutex locking (same pattern as boardflip). No background daemon, no persistent process. Restart safety, multi-user safety, and crash recovery all fall out naturally.

### 5.7 Project lives in its own repo, published under Gameweave org

The OSS project lives in a standalone repo published under the **Gameweave** organization (`gameweave/portweave`), not inside boardflip itself. Boardflip becomes its first real-world consumer and reference implementation.

---

## 6. Open for Discussion with Brian

This section has **no recommendation** — these are the open forks for the 1:1.

### 6.1 Config-style layering (named services is the floor; what goes on top?)

**Named services is required** as the floor of the config schema, because the boardflip-parity goal demands explicit env-var names (`API_PORT`, `VITE_PORT`) and constructed URLs (`WEBSOCKET_ENDPOINT = ws://localhost:${ws}`). A `portweave.config.json` declaring services explicitly is unavoidable.

The open question is what (if anything) to **layer on top**:

| Option                                | What it adds                                                                                                   | Pros                                                                                   | Cons                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **(a) Zero-config anonymous mode**    | `portweave run --count 3 -- npm run dev` injects `PORT_1`, `PORT_2`, `PORT_3` without a config file            | Lowest barrier to first run; great for one-off scripts; "I just need three free ports" | Pushes env-var naming back to user; doesn't help with discovery URLs               |
| **(b) Framework auto-detect adapter** | Detects Vite/Next/Nest/etc. from `package.json` and seeds default service entries (`vite` → `VITE_PORT`, etc.) | Smooth onboarding for common stacks                                                    | Fragile across framework versions; risks "magic" feel; ongoing adapter maintenance |
| **(c) Both layered on top**           | Provide (a) for ad-hoc use, (b) as `portweave init` auto-generates a starting config                           | Maximizes UX surface                                                                   | Largest surface area to build/maintain                                             |
| **(d) Neither — named-services only** | Hard floor; users always write the config                                                                      | Simplest implementation; clearest contract; nothing hidden                             | Higher first-run friction                                                          |

### 6.2 Package name — RESOLVED

**Decision:** Portweave (chosen over portsbook and portiva).

Strategic rationale captured in decision log row #11. Brief: the "ports" plural + "weave" suffix gives Portweave a unique mark in the local-dev tools namespace (portsbook had wordplay value but `portpilot`/`portly`-class collisions left it less distinctive; portiva had brandable-mark appeal but no descriptive hook). "Weave" also threads naturally into the Gameweave organization brand without being a sub-product of Gameweave.

### 6.3 License

Deferred — `LICENSE` is a TODO at v0. Likely MIT (dominant for OSS dev tools) but Brian to confirm.

### 6.4 JS-library API timing

Currently logged as deferred. Brian may want to pull forward — specifically because Vite/Next/Vitest config files run _before_ any wrapper child can inject env vars, so the only way to use portweave in those files is via `import`. This is a real DX concern even at v0.

Trade-off: deferring keeps v0 smaller; pulling forward keeps DX cleaner in JS projects. Boardflip's config files do read env vars at the right time, so for the parity goal alone we don't need the library. But for the "user installs portweave in a fresh Vite project and it just works" story, the library may be load-bearing.

### 6.5 Monetization roadmap sanity-check

The §8 roadmap sketches paid expansions (dev DNS, team sync, agent orchestration). Brian to weigh in on whether these belong on the v0+ horizon or are speculation worth bracketing out. Strategic position is real (every-dev-machine wedge with adjacent-product potential), but caveats apply (see strategy notes in [decision-log.md](./decision-log.md)).

---

## 7. v0 Feature Parity with Boardflip

v0 must reach **full feature parity** with boardflip's existing worktree-port system and be adoptable as a drop-in replacement. Honest estimate: **2–3 weeks** for a single developer with tests and docs.

This is not "small and easy." The original instinct ("first version very small") was correct for a minimum-spike v0, but the goal of drop-in replacement for an already-sophisticated system raises the floor.

### 7.1 Mechanism reconciliation

Portweave allocates a **block of ports per worktree from a machine-wide pool**. This is a strict superset of boardflip's per-project `base + offset*100` formula:

- Identical stickiness (same worktree → same ports across restarts)
- Identical all-services-move-together property
- Identical user-visible behavior in a single-project context
- Cross-project collision protection that boardflip's per-project offsets can't provide
- No 99-offset cap — machine-wide pool handles arbitrarily many worktrees

Boardflip drops it in and gets identical behavior plus the new guarantee.

### 7.2 Parity checklist

| #   | Boardflip capability                                                                        | Source (in [reference/boardflip/](../reference/boardflip/)) | Portweave v0 equivalent                                                                  |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Offset/block allocation                                                                     | `packages/shared/src/worktree-ports.ts`                     | Per-worktree block from machine-wide pool                                                |
| 2   | File-locked JSON registry with retry + stale-lock cleanup                                   | `scripts/src/utils/worktree-context-registry.ts`            | Same pattern at `~/.config/portweave/registry.json`                                      |
| 3   | Git worktree detection (`rev-parse`, `worktree list`)                                       | `scripts/src/utils/worktree-context-git.ts`                 | Same; cwd fallback for non-git dirs                                                      |
| 4   | Namespace derivation (main vs. feature-slug-hash)                                           | `scripts/src/utils/worktree-context-namespace.ts`           | Same; exposed via `PORTWEAVE_NAMESPACE` for PM2/log consumers                            |
| 5   | Env-var injection for named services                                                        | `scripts/src/utils/apply-worktree-env.ts`                   | Same; driven by `portweave.config.json`                                                  |
| 6   | Service-discovery URL construction (`WEBSOCKET_ENDPOINT`, `VITE_API_URL`, `E2E_API_ORIGIN`) | `apply-worktree-env.ts`                                     | Config supports `urlTemplate` per service: `WEBSOCKET_ENDPOINT = "ws://localhost:${ws}"` |
| 7   | Stale-entry pruning + last-used timestamps                                                  | `worktree-context-registry.ts`                              | Same                                                                                     |
| 8   | Explicit manual override (`GAMEWEAVE_WORKTREE_OFFSET` / `GAMEWEAVE_PM2_NAMESPACE`)          | `worktree-context-namespace.ts`                             | `PORTWEAVE_OFFSET` / `PORTWEAVE_NAMESPACE`                                               |
| 9   | `.env` seeding (dotenv-first, user overrides take priority)                                 | `apply-worktree-env.ts`                                     | Same                                                                                     |
| 10  | Multi-port services (Kinesis 4567 + 4568 move together)                                     | `ecosystem.config.cjs` (header comment)                     | Config supports service groups so paired ports allocate as a unit                        |
| 11  | E2E helper (configure Playwright env)                                                       | `scripts/src/utils/e2e-port-env.ts`                         | Same pattern via library helper + CLI                                                    |
| 12  | Wrapper CLI entry point                                                                     | `scripts/bin/dev.ts`                                        | `portweave run -- <cmd>`                                                                 |
| 13  | **NEW:** Live conflict detection (port already bound by external process)                   | not in boardflip                                            | `net.createServer().listen()` probe before claim; re-roll if taken                       |
| 14  | **NEW:** Cross-project collision protection                                                 | not in boardflip                                            | Machine-wide pool is the whole point                                                     |

### 7.3 Drop-in adoption test (v0 verification criterion)

After v0 ships, boardflip should be migratable in a single PR:

1. Delete `scripts/src/utils/worktree-context-*.ts` and related helpers
2. Delete `packages/shared/src/worktree-ports.ts`
3. Add `portweave.config.json` declaring boardflip's 8 services with their env-var names and URL templates
4. Change `scripts/bin/dev.ts` to invoke `portweave run` before its existing PM2 startup
5. Update PM2 ecosystem config to read process-name suffix from `PORTWEAVE_NAMESPACE` instead of internal helpers
6. **Acceptance:** all e2e tests still pass; worktree behavior identical from a user's POV; the e2e suite at `packages/e2e/` runs green in both `main` and at least one feature worktree simultaneously

### 7.4 Out-of-scope for v0 (genuinely deferred)

- Web UI / dashboard
- Docker Compose built-in integration (Compose users source `.portweave/current.env` manually)
- Multi-machine sync
- JS library import API (open per §6.4)
- Devcontainer port-forwarding management
- Auto-detect framework adapter (open per §6.1)

---

## 8. Future Roadmap (1–3 years)

Not commitments, just directional sketches. Strategic context: if Portweave becomes ubiquitous, the position unlocks several adjacent products — see [decision-log.md](./decision-log.md) for the monetization sketch.

- **Agent-spawned ephemeral allocations with TTL.** Coding agents may need many short-lived dev servers for verification runs. Registry entries grow a TTL; agents call `portweave release` when done; auto-prune handles crashes.
- **Cross-project discovery layer.** When one agent orchestrates `pnpm dev` in three repos that need to talk to each other (e.g., frontend → backend → auth-service), portweave becomes the source of truth for "where is foo's API right now?" via `portweave lookup foo:api`.
- **Local dev DNS.** `http://api.boardflip.dev` resolves to the right localhost port for the current worktree. Replaces `/etc/hosts` editing.
- **Team-shared registries.** "Brian's local stack is reachable at these tunneled endpoints." Tailscale-adjacent territory.
- **Docker Compose / devcontainer integration.** Native support for reconciling host port allocations with container forwarding rules.
- **`portweave list` / `portweave release` / `portweave reset` CLI surface.** Forensics and cleanup for power users.
- **Framework adapters.** Vite plugin, Next.js plugin, etc. — same allocation mechanism, but the framework consumes ports directly without manual env-var wiring.

---

## 9. Decision Log

The full decision log lives at [decision-log.md](./decision-log.md). The narrative form below recaps each in context.

| #   | Topic                         | Decision                                                                                   |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Where the project lives       | Standalone OSS repo under the Gameweave organization (`gameweave/portweave`).              |
| 2   | Form factor                   | npm package with CLI binary. Not pnpm-plugin-only.                                         |
| 3   | Architecture                  | Stateless file-locked JSON registry — no daemon.                                           |
| 4   | Allocation scope              | Machine-wide pool.                                                                         |
| 5   | Consumption                   | Wrapper CLI primary; always writes `.portweave/current.env` as side effect.                |
| 6   | JS-library API                | Deferred to post-v0. Open per §6.4 (Brian may pull forward).                               |
| 7   | v0 scope cap                  | Boardflip parity (all 14 capabilities in §7.2). ~2–3 weeks of work.                        |
| 8   | Registry location             | `~/.config/portweave/registry.json` (XDG).                                                 |
| 9   | Allocation mechanism          | Machine-wide pool with per-worktree block allocation.                                      |
| 10  | Config style                  | Named services is the floor; layered options open per §6.1.                                |
| 11  | Package name                  | **Portweave** (chosen over portsbook, portiva).                                            |
| 12  | License                       | Deferred to Brian (likely MIT).                                                            |
| 13  | Extract or write-fresh        | Write fresh, using boardflip as design blueprint (now captured in `reference/boardflip/`). |
| 14  | Drop-in adoption by boardflip | Yes — v0 verification criterion (§7.3).                                                    |
| 15  | Distribution org              | Gameweave organization, OSS publication.                                                   |
| 16  | Repo directory location       | `~/Documents/workspace/portweave/` (sibling to boardflip dir).                             |

---

## 10. Topics for Brian

Quick agenda for the 1:1, in priority order:

1. **Config-style layering** (§6.1) — biggest design fork still open. Pick (a), (b), (c), or (d).
2. **JS-library API timing** (§6.4) — pull forward to v0 for Vite/Next ergonomics, or defer?
3. **Scope reality-check** (§7) — 2–3 weeks for boardflip-parity v0 with tests + docs. Is that the right investment?
4. **License** (§6.3) — quick decision.
5. **Monetization roadmap sanity-check** (§6.5, §8) — does the adjacent-product roadmap shape v0 abstractions?
6. **AI/workflow contributions** — Brian to drive significant additions to `.claude/` skills (create-spec, execute-spec, create-feature) and `scripts/bin/dev-workflow.ts` orchestration.

---

## Appendix A — Sample `portweave.config.json`

Illustrative only — schema may evolve based on §6.1 decision.

```json
{
  "$schema": "https://portweave.dev/schema/v1.json",
  "services": {
    "api": {
      "envVar": "API_PORT",
      "preferred": 3001,
      "discoveryEnv": {
        "VITE_API_URL": "http://localhost:${api}",
        "E2E_API_ORIGIN": "http://localhost:${api}"
      }
    },
    "ws": {
      "envVar": "WS_PORT",
      "preferred": 3002,
      "discoveryEnv": {
        "VITE_WS_URL": "ws://localhost:${ws}",
        "WEBSOCKET_ENDPOINT": "http://localhost:${ws}"
      }
    },
    "vite": {
      "envVar": "VITE_PORT",
      "preferred": 5173
    },
    "dynamodb": {
      "group": "dynamodb",
      "envVar": "DYNAMODB_PORT",
      "preferred": 8000
    },
    "dynamodb-admin": {
      "group": "dynamodb",
      "envVar": "DYNAMODB_ADMIN_PORT",
      "preferred": 8001
    },
    "kinesis": {
      "group": "kinesis",
      "envVar": "KINESIS_PORT",
      "preferred": 4568
    },
    "kinesis-tls": {
      "group": "kinesis",
      "envVar": "KINESIS_TLS_PORT",
      "preferred": 4567
    },
    "ses": {
      "envVar": "SES_LOCAL_PORT",
      "preferred": 8005
    }
  }
}
```

The `group` key signals "these services move together as a unit" — addressing boardflip's Kinesis dual-port problem.

---

## Appendix B — Sample CLI session

```
$ cd ~/projects/boardflip-feature-x
$ portweave run -- pnpm dev
[portweave] worktree: boardflip-feature-x (namespace: feature-x-7a2b91)
[portweave] allocated:
  api               → 3104     (API_PORT)
  ws                → 3105     (WS_PORT)
  vite              → 5178     (VITE_PORT)
  dynamodb          → 8104     (DYNAMODB_PORT)
  dynamodb-admin    → 8105     (DYNAMODB_ADMIN_PORT)
  kinesis           → 4672     (KINESIS_PORT)
  kinesis-tls       → 4671     (KINESIS_TLS_PORT)
  ses               → 8109     (SES_LOCAL_PORT)
[portweave] wrote .portweave/current.env
[portweave] launching: pnpm dev
...
```
