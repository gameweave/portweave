# portweave panel — worktree triage, cleanup & quick actions

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/panel-triage/panel-triage.md](../../features/panel-triage/panel-triage.md)
**Decision-log rows:** [#42](../../decision-log.md) (panel reframe — read-only, All-OSS, _including future management features_), [#43](../../decision-log.md) (panel shipped), [#44](../../decision-log.md) (`readRegistryEntries` non-pruning read — **this spec refines it**), [#34](../../decision-log.md) (Portweave never manages processes — binding constraint), [#45](../../decision-log.md) (`projectName` config field), [#46](../../decision-log.md) (link scheme-allowlist), [#17](../../decision-log.md) (PW error-code numbering)

> Split per the [create-spec](../../../.claude/skills/create-spec/SKILL.md) "~200 lines → numbered sub-specs" rule and mirroring the shipped [management-panel](../management-panel/management-panel.md) layout. The work spans two loosely-coupled natures; this top-level file is the **index** (Problem, cross-cutting Approach, consolidated Acceptance criteria, Decision-log impact, Open questions). The sub-specs own the per-part detail:
>
> - [01-read-only-refinements.md](./01-read-only-refinements.md) — synthesized clickable links for every service + collapsible, persisted project/worktree groups. **No new security surface.** Independently shippable.
> - [02-write-actions-triage.md](./02-write-actions-triage.md) — per-worktree git/PR status (`gh`), main-vs-linked + safe-to-prune triage, on-disk size, the first **registry write** from the panel (`portweave prune` + a panel route), macOS quick-action launch, and the security model every mutating route requires.

## Problem

The shipped panel ([management-panel](../management-panel/management-panel.md), [decision-log #43](../../decision-log.md)) answers _"what is allocated where"_ as a strictly read-only view. Living with it surfaced two needs the feature doc captures in full.

**Worktree sprawl is the painful one.** Developers — and coding agents — spin up many git worktrees per repo; each carries its own `node_modules`/build output and quietly eats gigabytes. Most outlive the PR that justified them, but it is hard to tell _which_ are safe to delete, so they pile up (a real machine: 7 worktrees of one repo, ~20 GB, 4 with already-merged/closed PRs). The panel can _see_ them but cannot help _act_. And "is this worktree's work done?" is unanswerable from local git alone — squash/rebase merges leave a branch's commits out of `main`'s history (`git branch --merged` misses them) and a closed-not-merged PR is invisible locally. The reliable signal is the PR's state, which means asking GitHub via `gh`.

**The everyday preview is the smaller one.** Today a service is only a clickable link if its config declares a matching `discoveryEnv` URL ([decision-log #26](../../decision-log.md)); a frontend dev server with just a `PORT` env-var renders as a bare, un-clickable port. For "preview any version" to feel one-click, every service should be a link.

This iteration turns the read-only viewer into a lightweight **triage + cleanup surface** and tightens preview UX. It enacts the "future management features" [decision-log #42](../../decision-log.md) anticipated for the panel (All-OSS), while **respecting [decision-log #34](../../decision-log.md)**: Portweave still never manages service processes (no start/stop). The genuinely new line it crosses is the first **registry write from the panel** (pruning an allocation) — which the shipped frontend spec explicitly deferred ("Any mutation affordance (kill/release/prune/rename) — view-only POC", [02-frontend.md](../management-panel/02-frontend.md)) — making the security posture of an unauthenticated `127.0.0.1` server a first-class concern.

### The invariant this feature deliberately refines

[decision-log #44](../../decision-log.md) and the [management-panel index](../management-panel/management-panel.md) establish a load-bearing property: **the panel never writes the registry.** That holds today because every route is a `GET` reading through the non-pruning `readRegistryEntries` ([src/registry/storage.ts:98](../../../src/registry/storage.ts)), asserted byte-identical-after-requests by a test ([server.test.ts test 16](../../../src/panel/__tests__/server.test.ts)). Part B does **not** discard that invariant — it **scopes** it. The contract becomes:

- **The read path stays strictly read-only.** `GET /api/allocations` still goes through `readRegistryEntries`; the byte-identical-after-GET invariant test stays green, unchanged. A future maintainer must never "fix" it to write on a read.
- **One audited mutating route writes**, reusing the existing locked read-modify-write primitive (`withRegistry` + `handle.remove`), reachable only behind `Origin`/`Host` checks + a CSRF token + server-side confirmation.

This is recorded as a dated refinement to #44 on ship (see [Decision-log impact](#decision-log-impact)), not a rewrite of it — per the decision-log's append-don't-rewrite rule ([decision-log.md:5](../../decision-log.md)).

## Approach (cross-cutting)

Both parts extend the shipped pipeline rather than replace it: `readRegistryEntries` → per-entry enrich → grouped `PanelSnapshot` → JSON over `node:http` → the `panel/` Vite app. The shared seams:

- **The `PanelSnapshot` contract** ([src/panel/types.ts](../../../src/panel/types.ts), mirrored in `panel/src/types.ts` — duplicate pinned by the server contract test, [decision-log #43](../../decision-log.md)). Part A leaves it unchanged; Part B extends `PanelWorktree` additively (`kind`, `prStatus`, `workingTreeClean`, `diskSizeBytes`, `safeToPrune`, `removeCommand`) and adds `PanelSnapshot.prStatusAvailable`. Additive only — never rename/remove a shipped field.
- **The `EnrichDeps` injection seam** ([src/panel/enrich.ts:34](../../../src/panel/enrich.ts)) — today carries the liveness `probe`; Part B threads the (cached) triage provider through it the same way, keeping `enrich.ts` unit-testable with stubs.
- **The helper-extraction discipline.** The backend `src/**` files obey ESLint `max-lines: 250` with `skipComments: false` ([config/eslint/complexity-rules.ts](../../../config/eslint/complexity-rules.ts)); `enrich.ts` is already 219 lines and `server.ts` is **exactly at the 250-line cap**. **Every new concern lands in its own small module** (the established `links.ts`/`labels.ts`/`liveness.ts` pattern) so `enrich.ts`/`server.ts` only _call_ the new logic. This is the #1 structural constraint and is called out in both sub-specs.

### Sequencing

01 is **independently shippable** — pure read-path UX, no new routes, no security surface. 02 builds on 01's collapsible `WorktreeCard` (the natural home for triage chrome) and extends the same `PanelSnapshot` types. **Land 01 first** to avoid type-file churn; 02's security model is a hard prerequisite _within_ 02 for any mutating route. Implement A, then B.

### Module layout (new/changed, all under `src/` unless noted)

| File                               | Part | Responsibility                                                                                                                                                                  |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/panel/service-links.ts` (new) | A    | Pure `resolveServiceLinks(explicit, port)` — synthesize a `http://localhost:<port>` link when no explicit `http(s)` link exists.                                                |
| `src/panel/enrich.ts` (changed)    | A, B | Call `resolveServiceLinks` in `healthy()`/`degraded()`; attach triage fields per worktree (B).                                                                                  |
| `src/github/pr-status.ts` (new)    | B    | `gh`-backed PR state — optional, graceful. New `PW08xx` error block.                                                                                                            |
| `src/worktree/status.ts` (new)     | B    | `git status --porcelain` clean/dirty (builds on [src/worktree/git.ts](../../../src/worktree/git.ts)).                                                                           |
| `src/panel/triage.ts` (new)        | B    | Pure `safeToPrune` + `removeCommand` derivation.                                                                                                                                |
| `src/panel/triage-cache.ts` (new)  | B    | In-memory, TTL'd per-worktree cache of {PR, clean, size}.                                                                                                                       |
| `src/panel/disk-size.ts` (new)     | B    | `du -sk` size (macOS/Linux; `null` elsewhere).                                                                                                                                  |
| `src/panel/security.ts` (new)      | B    | `Origin`/`Host` allowlist + per-session CSRF token.                                                                                                                             |
| `src/panel/prune.ts` (new)         | B    | Shared `pruneAllocation(key, env)` — the one write path.                                                                                                                        |
| `src/panel/server.ts` (changed)    | B    | Mutating routes (`POST /api/prune`, `POST /api/open`) behind `security.ts`; CSRF-token injection into served `index.html`.                                                      |
| `src/cli/prune.ts` (new)           | B    | `runPrune` + `registerPruneCommand`, modeled on [src/cli/show.ts](../../../src/cli/show.ts).                                                                                    |
| `src/cli.ts` (changed)             | B    | One-line `registerPruneCommand(program)`.                                                                                                                                       |
| `src/errors.ts` (changed)          | B    | New PW codes (`PW06xx` panel/security, `PW08xx` GitHub).                                                                                                                        |
| `panel/` (changed)                 | A, B | Collapsible groups + persisted state (A); PR badge, size, safe-to-prune marker, prune button + confirm, launch/copy buttons, CSRF header (B). No backend gate touches `panel/`. |

## Acceptance criteria (consolidated)

Per-part ACs are authoritative in their sub-specs; this is the roll-up.

### Part A — read-only refinements ([01](./01-read-only-refinements.md))

- [ ] Every healthy service exposes ≥1 clickable link: an explicit `http(s)` `discoveryEnv` URL when present, else a synthesized `http://localhost:<allocated-port>`; degraded services also get a synthesized link. Every `PanelLink.url` still passes `isSafeLinkUrl`. Verified by `src/panel/__tests__/service-links.test.ts` + extended `enrich.test.ts`.
- [ ] Projects and worktrees collapse/expand; the state survives a Refresh (persisted in `localStorage`). Manual smoke (frontend unit tests out of scope, per the [management-panel precedent](../management-panel/02-frontend.md)).
- [ ] Grouping is confirmed unchanged: group by `gitCommonDir`, label by `projectName` ([src/panel/labels.ts](../../../src/panel/labels.ts)); cross-repo name-merging stays rejected. No code change; pointed at existing `enrich.test.ts` label cases.
- [ ] The existing read-only invariant (byte-identical registry after `GET`s, [server.test.ts test 16](../../../src/panel/__tests__/server.test.ts)) still passes — Part A introduces no write.
- [ ] `npm run dev-workflow` green; new `src/panel/*.ts` meet the 80% coverage thresholds; `enrich.ts` stays under the 250-line cap.

### Part B — write actions + triage ([02](./02-write-actions-triage.md))

- [ ] When `gh` is present and authenticated, each worktree shows its branch PR state (`open`/`closed`/`merged`); when `gh` is missing, unauthenticated, on a non-GitHub remote, or rate-limited, the panel renders everything else with no error and no PR badge (`prStatusAvailable: false` when globally unavailable). PR state is cached.
- [ ] A worktree is marked `safeToPrune` **iff** it is a _linked_ worktree **and** its PR is merged/closed **and** its working tree is clean. The main checkout is never marked. A merged-but-dirty or PR-unknown worktree is never marked.
- [ ] Each worktree shows its on-disk size (or `null` where unavailable, e.g. non-`du` platforms). Size is cached.
- [ ] `portweave prune` removes exactly the targeted allocation (cwd by default, `--path <dir>` override) and leaves all other _valid_ entries unchanged; it works with the panel closed; "nothing to prune" exits 1 with a clear message. The panel's prune route calls the identical `pruneAllocation` path.
- [ ] The read path stays read-only (test 16 intent intact); the routing-matrix test is updated (POST is no longer universally 405); a new test asserts the mutating route writes while `GET` stays byte-identical.
- [ ] Directory removal is surfaced as a copyable `git worktree remove <root>` command (correctly quoted; `--force` shown separately with a dirty-tree warning), never executed.
- [ ] Quick actions launch an editor and a terminal at the worktree root **on macOS** via a security-gated `POST /api/open`; on non-macOS the panel still shows the path and the launch is a graceful no-op.
- [ ] Security: a cross-origin / bad-`Host` mutating request is rejected `403`; a mutating request without the per-session CSRF token is rejected `403`; prune additionally requires server-side `confirm: true`; `GET` routes are unaffected.
- [ ] New PW codes land in the correct blocks (`PW06xx` panel/security, `PW08xx` GitHub), never renumbering a published code.
- [ ] `npm run dev-workflow` green; all new `src/**` modules meet 80% coverage; `enrich.ts`/`server.ts` stay under the 250-line cap (logic pushed into the new helper modules).

## Decision-log impact

Appended to [.ai/decision-log.md](../../decision-log.md) **on ship** (not now). Captured here so they are not lost. New rows continue from the current tail (#46); final numbers reconcile at ship.

- **Panel's first registry write (prune) — refines [#44](../../decision-log.md).** The `GET`/read path remains strictly read-only (still `readRegistryEntries`, still byte-identical under the test-16 invariant). One audited mutating route (`POST /api/prune`) writes via the existing `withRegistry` + `handle.remove` primitive ([src/registry/storage.ts:42](../../../src/registry/storage.ts)) — no hand-edited JSON — behind `Origin`/`Host` + CSRF-token + server-side `confirm`. The #44 "never add a write to the read path" warning still stands; this is a separate, explicit route.
- **Panel security model for mutating routes.** `Origin`/`Host` allowlist (`127.0.0.1`/`localhost:<port>`) defeats DNS-rebinding; a per-session CSRF token (`crypto.randomBytes`, injected into the served `index.html`, required via `X-Portweave-CSRF`) defeats cross-site forgery; destructive actions require an explicit `confirm`. Rationale: loopback is not a security boundary — any page in the user's browser can POST to `127.0.0.1`.
- **`gh`-sourced PR status — optional, cached, graceful.** New `PW08xx` GitHub error block. The panel never errors or degrades because `gh` is absent; PR state is simply omitted. GitHub-only (no GitLab/Bitbucket); cached in-process with a 60 s TTL; no disk persistence (preserves no-daemon, [#3](../../decision-log.md)).
- **macOS-only quick-action launch.** `POST /api/open` launches an editor/terminal at a worktree root **on macOS** (`open -a …`), behind the security model, with the target path validated against known allocation roots and spawned via an argv array (never a shell). Non-macOS degrades gracefully; Windows/Linux launchers are left for contributors. Launching an external editor/terminal at a path is _not_ service-process management, so [#34](../../decision-log.md) holds.
- **`portweave prune` CLI command.** Removes the cwd's allocation (or `--path <dir>`) via the shared `pruneAllocation` path; symmetric with `portweave show`.
- **Synthesized localhost preview links — extends [#46](../../decision-log.md).** Every service renders as a clickable link; absent an explicit `http(s)` discovery URL, the panel synthesizes `http://localhost:<port>` (scheme always `http`, so the #46 allowlist is satisfied by construction). Non-HTTP ports become harmless dead links — accepted over guessing which ports are browser-openable.

## Open questions

**None blocking** — the feature doc's open questions are resolved in the sub-specs:

- **Spec split** → confirmed: this umbrella + [01](./01-read-only-refinements.md) + [02](./02-write-actions-triage.md).
- **`gh` coupling** → acceptable as a strictly optional, cached, GitHub-only integration; 60 s TTL; rate-limit/non-GitHub/unauth all collapse to "omit, no error". Detail in [02](./02-write-actions-triage.md).
- **Security model** → `Origin`/`Host` + per-session CSRF token + server-side `confirm`; the #44 refinement above is the decision-log entry. Detail in [02](./02-write-actions-triage.md).
- **`portweave prune` scope** → registry allocation only; directory removal stays copy-the-command; target is cwd or `--path` (no heuristic — auto-pruning is out of scope). Detail in [02](./02-write-actions-triage.md).
- **Per-render cost** → clean/dirty + PR + size cached per-worktree (60 s TTL) in the server process; liveness stays live; manual Refresh + `?refresh=1` force-bypass. Detail in [02](./02-write-actions-triage.md).
- **Cross-platform quick actions** → macOS only for v1 (graceful elsewhere). Detail in [02](./02-write-actions-triage.md).
- **Directory removal** → copy-the-command for v1; executing it (behind guards) is explicitly deferred.

One minor deferred polish: a `PanelLink.synthesized?` flag so the frontend can style synthesized vs explicit links differently — out of scope for v1 (the empty `envVar` already discriminates). Noted in [01](./01-read-only-refinements.md).
