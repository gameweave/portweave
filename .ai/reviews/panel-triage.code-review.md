---
title: 'Panel Triage — Read-Only Refinements + Write Actions & Triage'
source: '.ai/specs/panel-triage/panel-triage.md'
status: needs-fixes
severity: medium
reviewed: 2026-06-07
reviewer: code-review-subagent
---

# Code Review: Panel Triage (Parts A + B)

## Summary

Reviewed the uncommitted `panel-triage` implementation against the three specs
(umbrella + 01 read-only-refinements + 02 write-actions-triage). The work is
high quality and broadly faithful to the spec: synthesized links, collapsible
groups, `gh` PR status, safe-to-prune derivation, on-disk size, the cached
triage provider, the `pruneAllocation` write path, the macOS launch, and the
full security model are all implemented and well-tested. Typecheck passes and
the full suite is green (557 passing, global coverage 89.8% stmts / 82.8%
branch). The most significant issue is an integration seam: the
`GET /api/allocations?refresh=1` path constructs a brand-new triage provider
with real `gh`/`git`/`du` boundaries, bypassing the injected provider the
server was started with — which both violates the spec's "one provider
instance per server" intent and leaves that user-facing path untested.

## Source

- **Spec:** `.ai/specs/panel-triage/panel-triage.md` (+ `01-read-only-refinements.md`, `02-write-actions-triage.md`)
- **Feature doc:** `.ai/features/panel-triage/panel-triage.md` (present, untracked)
- **Branch:** `feat/portweave-panel`
- **Files reviewed:** 40 (17 modified, 23 untracked) — all panel-triage backend + frontend + tests
- **Changes analyzed:** synthesized links, collapsible UI, PR status, triage cache, prune (CLI + route), launch, security model, PW codes

## Accuracy Assessment

| Requirement                                                                                                                                   | Status         | Notes                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-1: every healthy service ≥1 clickable link; synthesize `http://localhost:<port>` when no explicit http(s); degraded services too            | ✅ Implemented | `service-links.ts` + `enrich.ts` `healthy()`/`degraded()` both route through `resolveServiceLinks`.                                                                |
| A-1: explicit http(s) wins; ws/wss preserved alongside synthesized; bad port → no synthesis; every url passes `isSafeLinkUrl`                 | ✅ Implemented | `service-links.ts:18-32`; covered by `service-links.test.ts` + `enrich.test.ts`.                                                                                   |
| A-2: collapsible projects/worktrees; state persisted to localStorage with safe fallback                                                       | ✅ Implemented | `useCollapseState.ts` guards parse + storage; `ProjectGroup`/`WorktreeCard` chevron + `aria-expanded`.                                                             |
| A-3: grouping by `gitCommonDir`, label by `projectName`, no code change                                                                       | ✅ Implemented | Unchanged; existing label tests stand (`enrich.test.ts` 4a–4c).                                                                                                    |
| B-1: `gh` PR status; graceful degrade on missing/unauth/non-GitHub/rate-limit; cached; `prStatusAvailable` flag                               | ✅ Implemented | `pr-status.ts` async `execFile`; `ghIsAvailable` short-circuits per snapshot; `triage-cache.ts` gates `fetchPrStatus`.                                             |
| B-2: `kind` from `mainRoot` (not namespace); `worktreeIsClean` clean/dirty/unknown                                                            | ✅ Implemented | `triage-cache.ts:52-60` derives kind from `mainRoot`; `status.ts` inspects exit status explicitly.                                                                 |
| B-3: `safeToPrune` iff linked ∧ PR merged/closed ∧ clean===true; main never; PR-unknown never; dirty/null never                               | ✅ Implemented | `triage.ts:9-20`; all six conjunct cases covered in `triage.test.ts`.                                                                                              |
| B-3: `removeCommand` POSIX-quoted, safe (non-force) form                                                                                      | ✅ Implemented | `triage.ts:27-31`; space + embedded-quote cases tested.                                                                                                            |
| B-4: on-disk size via `du -sk`; null off-du/failure; cached                                                                                   | ✅ Implemented | `disk-size.ts`; win32 guard + parse-failure paths tested.                                                                                                          |
| B-5: cached TTL'd triage provider threaded via `EnrichDeps.triage`; liveness NOT cached; server owns one instance; `?refresh=1` force-bypass  | ⚠️ Partial     | Provider/cache/threading correct, BUT the server's `?refresh=1` path builds a _fresh_ provider with real boundaries instead of reusing the injected one (see M-1). |
| B-6: `pruneAllocation` reuses `withRegistry` + `handle.remove`; one code path; CLI + route share it                                           | ✅ Implemented | `prune.ts` (panel) + `cli/prune.ts` + `post-handlers.ts` all call `pruneAllocation`.                                                                               |
| B-6: `portweave prune` cwd default / `--path`; valid siblings intact; works panel-closed; "nothing to prune" exits 1 with `CLI_NO_ALLOCATION` | ✅ Implemented | `cli/prune.ts`; covered by `cli/__tests__/prune.test.ts` (5 cases).                                                                                                |
| B-6: read path stays read-only (test 16 intact); routing-matrix updated; new test asserts prune writes while GET byte-identical               | ✅ Implemented | `server.test.ts` tests 16, 17 (rewritten), 19.                                                                                                                     |
| B-7: bad Host/Origin → 403; missing/invalid CSRF → 403; prune needs `confirm` (400 without); GET unaffected; CSRF injected into `/`           | ✅ Implemented | `security.ts` + `post-handlers.ts` + `server.ts`; thorough `security.test.ts` (incl. array-header edge cases).                                                     |
| B-8: macOS launch editor+terminal via gated `POST /api/open`; argv-array spawn; path validated vs allocation roots; non-mac graceful no-op    | ✅ Implemented | `launch.ts` (argv array, `shell: false`, detached/unref); `post-handlers.ts` `isKnownAllocationRoot`; argv-safety + platform tests.                                |
| B-9: `removeCommand` never executed; `--force` shown only with dirty warning                                                                  | ✅ Implemented | `WorktreeCard.tsx` `forceRemoveCommand` + `force-warning` block, copy-only.                                                                                        |
| New PW codes in correct blocks, none renumbered                                                                                               | ✅ Implemented | `errors.ts` PW0605/0606/0607 (panel), PW0801/0802 (github); `errors.test.ts` updated.                                                                              |
| PanelSnapshot additive extension; `panel/src/types.ts` mirror matches                                                                         | ✅ Implemented | `src/panel/types.ts` and `panel/src/types.ts` are structurally identical.                                                                                          |
| Frontend request shapes: prune `{worktreeRoot,namespace,gitCommonDir,confirm}`, open `{target,worktreeRoot}`, `X-Portweave-CSRF`              | ✅ Implemented | `panel/src/api.ts` matches server expectations exactly.                                                                                                            |
| `enrich.ts`/`server.ts` stay under 250-line cap                                                                                               | ✅ Implemented | enrich 246, server 249, post-handlers 244 — passing but near-the-line (see P-1).                                                                                   |

## Completeness Assessment

### Implemented

- All new backend modules from the module-layout table: `service-links.ts`, `triage.ts`, `triage-cache.ts`, `disk-size.ts`, `security.ts`, `launch.ts`, `prune.ts`, `enrich-triage.ts`, `post-handlers.ts`, `src/github/pr-status.ts`, `src/worktree/status.ts`, `src/cli/prune.ts`.
- All changed integration points: `enrich.ts`, `server.ts`, `types.ts` (both copies), `errors.ts`, `cli.ts`, `errors.test.ts`, `knip.json` (`ignoreBinaries: ["gh"]`).
- All frontend pieces: `App.tsx`, `ProjectGroup.tsx`, `WorktreeCard.tsx`, `api.ts`, `types.ts`, `theme.css`, new `CopyButton.tsx`, `PrBadge.tsx`, `format.ts`, `hooks/useCollapseState.ts`.
- Test files for every new module except one (see Missing).

### Missing or Incomplete

- **`src/panel/__tests__/prune.test.ts` was specified (02 Test layout) but not created.** `pruneAllocation`'s behavior is nonetheless exercised indirectly by `server.test.ts` test 19 and `cli/__tests__/prune.test.ts`. The direct unit (matched-key `removed:true`, absent-key `removed:false`, valid siblings intact) is not isolated. Minor — see MI-2.
- **`?refresh=1` route branch is untested** (`server.ts:94`). Coverage gap; the branch is the obvious driver of `server.ts` branch coverage being the lowest in the panel module set. See M-1.

### Beyond Scope

- **`src/cli/__tests__/show.test.ts` refactor** (-101/+42 lines): extracted `makeEntry`/`seedEntry`/`runCapture`/`expectExitCode` into the shared `_helpers.ts` so the new prune test can reuse them. Sensible DRY, no behavior change, but a touched file outside the strict spec scope — flagging for visibility.
- **`GITHUB_GH_UNAVAILABLE` (PW0801), `GITHUB_PR_QUERY_FAILED` (PW0802), `PANEL_LAUNCH_FAILED` (PW0607)** are defined but never emitted anywhere in `src/` (only referenced in `errors.test.ts`). The spec anticipated PW0801/0802 as "mostly internal/logging — swallowed", so reserving-without-emitting is defensible, but PW0607 was specced as the surfaced code when "editor/terminal spawn failed / launcher not found"; the route instead returns `launchAt`'s `{launched:false, reason}` and never references PW0607. See MI-1.

## Issues Found

### 🔴 Critical

None.

### 🟠 Major

- **M-1**: `?refresh=1` builds a fresh triage provider with real boundaries, bypassing the injected one — `src/panel/server.ts:93-96`
  - **Impact:** Two problems. (1) **Spec intent violated:** B-5 says "The server owns one provider instance ... and passes it on every request — so the cache actually persists across Refreshes." On a force-refresh the server discards `deps.triage` and calls `createTriageProvider({ forceRefresh: true })`, which constructs with `DEFAULT_DEPS` (real `ghIsAvailable`/`fetchPrStatus`/`worktreeIsClean`/`diskSizeBytes`). So a server started with an injected stub provider (tests, or any programmatic embed) will, on `?refresh=1`, shell out to real `gh auth status`, `gh pr view`, `git status`, and `du`. (2) **Untested path:** no server test exercises `?refresh=1` (`server.ts:94` branch is uncovered), precisely because there is no seam to inject a stub through. The cache also doesn't actually persist a forced-refresh result back into the long-lived provider — the fresh provider is discarded after the request, so the next non-refresh GET still serves the stale cached entry from the original provider.
  - **Suggested fix:** Give `TriageProvider` a way to force a single refresh that reuses the original boundaries — e.g. `triageFor(root, { force?: boolean })`, or hold the resolved `TriageDeps` on the server and pass them into the forced provider: `createTriageProvider({ deps: serverDeps, forceRefresh: true })`. Thread an injectable factory through `StartPanelServerOptions` so a test can assert the refresh path. At minimum, reuse `deps.triage`'s underlying deps rather than `DEFAULT_DEPS`, and add a `?refresh=1` server test.

### 🟡 Minor

- **MI-1**: `PANEL_LAUNCH_FAILED` (PW0607) is defined but never emitted — `src/errors.ts:17`, `src/panel/post-handlers.ts:170-193`, `src/panel/launch.ts`
  - **Suggested fix:** Either map a `launchAt` failure (`launched:false` with `reason==='launch-failed'`) to a response carrying `PANEL_LAUNCH_FAILED` in `handleOpen`, or drop the unused code with a one-line decision-log note that launch failures are surfaced via the `reason` field instead of a PW code. (Same call applies to PW0801/0802, which the spec already frames as logging-only/reserved — those are more defensible to leave unemitted.)

- **MI-2**: Specced `src/panel/__tests__/prune.test.ts` not created — `src/panel/prune.ts`
  - **Suggested fix:** Add the direct unit (matched key → `removed:true`; absent key → `removed:false`; valid siblings unchanged) the spec's Test layout lists. Behavior is covered transitively today, but the isolated test is cheap insurance and was an explicit deliverable.

- **MI-3**: `handlePrune` casts `namespace`/`worktreeRoot` to `string` without runtime validation — `src/panel/post-handlers.ts:144-149`
  - **Suggested fix:** `handleOpen` validates `typeof worktreeRoot === 'string'` and 400s otherwise; `handlePrune` does not (it casts `body.namespace as string`, `body.worktreeRoot as string`). A client sending `{confirm:true}` with no `worktreeRoot` produces a key of `{worktreeRoot: undefined, ...}` which `keysEqual` strict-compares (no coercion), matches nothing, and returns `200 {removed:false}` — not a security hole, but inconsistent and a 400 would be the honest response. Add the same `typeof === 'string'` guard for symmetry.

### 🟢 Suggestions

- **S-1**: `methodNotAllowed` always advertises `Allow: GET, POST` — `src/panel/server.ts:135-141`
  - **Rationale:** A `POST /api/allocations` correctly 405s, but the `Allow` header tells the client `POST` is permitted on that route, which is misleading (it's GET-only). Minor HTTP-correctness nicety; could compute the allowed set per pathname. Not worth much churn.

- **S-2**: `forceRemoveCommand` reconstructs the `--force` variant via string `.replace` on the backend command — `panel/src/components/WorktreeCard.tsx:16-21`
  - **Rationale:** Works (single-occurrence replace of the fixed `git worktree remove ` prefix the backend always emits), but couples the frontend to the backend's exact command prefix. If `deriveRemoveCommand` ever changed wording, this silently produces a wrong/identical string. A backend-provided `forceRemoveCommand` field (or having the frontend build both from `worktreeRoot`) would be more robust. Deferred-polish territory.

## Potential Issues

- **P-1**: `enrich.ts` (246), `server.ts` (249), `post-handlers.ts` (244) sit 1–6 lines under the `max-lines: 250` cap — `src/panel/*.ts`
  - **Risk:** The spec named this the "#1 structural constraint." `server.ts` at 249/250 has effectively zero headroom; the next one-line change (e.g. the M-1 fix, which touches `server.ts`) will breach the cap and fail `complexity:check`.
  - **Recommendation:** When applying M-1, push the refresh-provider construction into a tiny helper (or into `triage-cache.ts`) rather than adding lines to `server.ts`. Consider proactively extracting a few lines from `server.ts`/`post-handlers.ts` to restore headroom.

- **P-2**: `pruneAllocation` opportunistically drops _other_ deleted-dir entries via `withRegistry`'s stale-prune-on-write — `src/panel/prune.ts:20-24`, `src/registry/storage.ts:125`
  - **Risk:** The AC "leaves all other entries unchanged" holds only for _valid_ (non-stale) siblings. This is documented in the spec (B-6) and tests seed only valid siblings, so it is intended — but a user pruning worktree A while worktree B's directory happens to be deleted will see B's entry vanish too.
  - **Recommendation:** None required (intended + documented). Worth a one-line note in the `portweave prune` help or release notes so the behavior isn't surprising.

- **P-3**: `?refresh=1` cold cost on the long-lived provider — `src/panel/server.ts`, `src/panel/triage-cache.ts`
  - **Risk:** Tied to M-1: because the forced provider is discarded, a forced refresh does not warm the persistent cache. After a prune the frontend calls `?refresh=1` (App.tsx `onAction`), gets fresh data, but the _next_ ordinary Refresh re-serves the original provider's now-stale cache (until its TTL lapses). Mostly cosmetic given the 60s TTL, but it undercuts the "re-check immediately after merging" UX the force-bypass exists for.
  - **Recommendation:** Folded into the M-1 fix — refresh through the persistent provider so the warmed entry sticks.

## Code Quality

### Patterns & Consistency

Strong. New modules mirror the established `links.ts`/`labels.ts`/`liveness.ts`
extraction discipline; every new concern is its own small module and
`enrich.ts`/`server.ts` only call into them. Dependency-injection seams
(`RunGh`, `RunDu`, `SpawnLauncher`, `WhichProbe`, `TriageDeps`,
`EnrichDeps.triage`, `StartPanelServerOptions.security/triage`) are consistent
with the existing `probe` injection and keep CI off real `gh`/`git`/`du`. The
`buildPanelSnapshot(env, deps?)` contract is preserved (additive `deps?`).
`enrich-triage.ts`'s `stampTriage` + `DEFAULT_TRIAGE` cleanly centralizes the
six derived fields for both healthy and degraded paths. The frontend↔server
contract (request shapes, CSRF header, the two `types.ts` mirrors) lines up
exactly.

### Error Handling

Conformant to `.claude/rules/error-handling.md`. Catch variables are `unknown`
and narrowed (`caught instanceof Error`) in the frontend; every swallow carries
a `// pw-allow-swallow:` justification (`disk-size.ts:38`, `launch.ts:103/145`,
`pr-status.ts:50/82`, `post-handlers.ts:107/111/241`, `useCollapseState.ts`,
`CopyButton.tsx`). The graceful-degradation contract (gh/du/launch failures →
typed null/`{launched:false}`, never a throw) is faithfully implemented and
tested ("never throws" cases in `launch.ts`/`pr-status.ts`/`disk-size.ts`).
`pruneAllocation` returns `Result<…, PortweaveError>`. The pre-existing
`enrich.ts:124` rethrow (non-`ENV_BUILD_INVALID`) is unchanged by this work.

### Type Safety

Clean. No new `any`. `import type` used under `verbatimModuleSyntax`; relative
imports carry `.ts` extensions. `singleHeader` correctly folds the
`string|string[]|undefined` header union to a single matchable value (and tests
prove array headers are rejected, not first-element-coerced). The only soft
spot is the unchecked casts in `handlePrune` (MI-3).

### Test Coverage

Excellent breadth. Full suite green (557 pass / 2 skip), global coverage
89.8% stmts / 82.8% branch / 92.0% funcs — over the 80% gate (thresholds are
global, not per-file, so individual files dipping below 80% in scoped runs do
not fail the gate). Security (incl. DNS-rebinding/cross-origin/array-header
edges), launch (argv-safety, every failure mode, async/sync spawn), triage
cache (miss/hit/TTL/forceRefresh/per-key/concurrency/gh-unavailable),
safe-to-prune (all six conjuncts), service-link synthesis, prune (CLI +
route + 403/400 gates), and the read-only invariant (test 16 unchanged) are all
covered with real I/O against tmpdirs. Gaps: the `?refresh=1` route branch
(M-1), and the specced standalone `prune.test.ts` (MI-2).

## Verdict

**Status:** needs-fixes

### Summary of Findings

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical         | 0     |
| 🟠 Major            | 1     |
| 🟡 Minor            | 3     |
| 🟢 Suggestions      | 2     |
| ⚠️ Potential Issues | 3     |

### Required Actions

1. Fix M-1: Make `?refresh=1` reuse the server's injected provider/deps (not real `DEFAULT_DEPS`), warm the persistent cache, and add a `?refresh=1` server test. Apply the fix without breaching `server.ts`'s 250-line cap (P-1).

### Recommended Actions

1. Address MI-1: emit `PANEL_LAUNCH_FAILED` from `handleOpen` on a launch failure, or remove the unused code with a decision-log note.
2. Address MI-2: add the specced `src/panel/__tests__/prune.test.ts` direct unit.
3. Address MI-3: validate `worktreeRoot`/`namespace` types in `handlePrune` (400 on non-string), matching `handleOpen`.
4. Consider S-1 (per-route `Allow` header) and S-2 (backend-provided force command) as low-priority polish.
