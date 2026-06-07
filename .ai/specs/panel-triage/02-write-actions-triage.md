# panel triage — Part B: write actions, worktree triage & quick actions

**Parent:** [panel-triage.md](./panel-triage.md) (index — Problem, consolidated AC, Decision-log impact, Open questions)
**Sibling:** [01-read-only-refinements.md](./01-read-only-refinements.md) (the read-path UX this builds on)

This sub-spec owns the triage + cleanup half: per-worktree git/PR status, the main-vs-linked + safe-to-prune signal, on-disk size, the panel's **first registry write** (`portweave prune` + a panel route), macOS quick-action launch, and the security model every mutating route requires. **Depends on [01](./01-read-only-refinements.md)** for the collapsible `WorktreeCard` that hosts the new chrome and for the shared type files. Within this part, the [security model](#b-7-security-model-for-mutating-routes) is a hard prerequisite for any mutating route.

Per the [index](./panel-triage.md), the structural constraint throughout is the `max-lines: 250` cap ([config/eslint/complexity-rules.ts](../../../config/eslint/complexity-rules.ts)): `enrich.ts` (219) and `server.ts` (250, exactly at the cap) have ~no headroom, so **every new concern below lands in its own module** and `enrich.ts`/`server.ts` only call into them.

## The `PanelSnapshot` contract extension

Additive only (never rename/remove a shipped field, [decision-log #43](../../decision-log.md)). In [src/panel/types.ts](../../../src/panel/types.ts) and mirrored in `panel/src/types.ts` (duplicate pinned by the server contract test). Field/arm ordering follows the repo's perfectionist sort (ascending) so the snippet matches what lint emits.

```typescript
/** main checkout vs a linked worktree (git lists the main checkout first). */
export type WorktreeKind = 'linked' | 'main'

/** GitHub PR state for a worktree's branch. Absent (null) when unknown. */
export type PrState = 'closed' | 'merged' | 'open'

export interface PanelPrStatus {
  readonly number: null | number
  readonly state: PrState
  readonly url: null | string
}

export interface PanelWorktree {
  readonly degraded: boolean
  readonly degradedReason: null | string
  readonly diskSizeBytes: null | number // null = not computed / unavailable / non-du platform
  readonly kind: WorktreeKind
  readonly lastUsedAt: string
  readonly namespace: string
  readonly prStatus: null | PanelPrStatus // null = no PR, non-GitHub remote, or gh unavailable
  readonly removeCommand: string // copyable `git worktree remove <root>` (safe form)
  readonly safeToPrune: boolean // derived; true only under all three conjuncts (B-3)
  readonly services: readonly PanelService[]
  readonly workingTreeClean: boolean | null // null = git status failed / unknown
  readonly worktreeRoot: string
}

export interface PanelSnapshot {
  readonly generatedAt: string
  readonly launchSupported: boolean // process.platform === 'darwin' for v1
  readonly projects: readonly PanelProject[]
  readonly prStatusAvailable: boolean // gh present + authenticated machine-wide
}
```

`launchSupported` and `prStatusAvailable` are machine-level capability flags the frontend uses to decide whether to render launch buttons / PR badges (vs. degrade to path-only / no-badge). They are set when the snapshot is built (see [B-5](#b-5-per-render-cost--the-cached-triage-provider)).

## B-1. Per-worktree git/PR status via `gh`

### New module: `src/github/pr-status.ts` (claims the `PW08xx` block)

A distinct external-tool boundary, parallel to [src/worktree/git.ts](../../../src/worktree/git.ts). It gets its own component and error block (`PW08xx`, "reserved" per [decision-log #17](../../decision-log.md)) rather than being buried in `src/panel/` — the panel _consumes_ it, but the `gh`-shelling logic is independently testable and reusable.

```typescript
import type { PrState } from '../panel/types.ts'

export interface PrStatus {
  readonly number: null | number
  readonly state: PrState
  readonly url: null | string
}

/** gh present AND authenticated. Checked once per snapshot, not per worktree. */
export function ghIsAvailable(): boolean

/**
 * PR state for the current branch of `worktreeRoot`, or null when there is no
 * PR / a non-GitHub remote / gh failed. Never throws — absence is a valid
 * state, mirroring the config-missing degraded path. Slow (network), so callers
 * must run these concurrently and cache (see B-5).
 */
export function fetchPrStatus(worktreeRoot: string): Promise<null | PrStatus>
```

- **Shelling out** mirrors `runGit`'s shape ([git.ts:92-105](../../../src/worktree/git.ts)) but **asynchronously** — `gh pr view` is a network call, so use a non-blocking spawn (`execFile` promisified), never `spawnSync`, so the per-worktree fetches parallelize across the snapshot instead of serializing and freezing the event loop (the same concurrency posture as the liveness probes, [enrich.ts:62-75](../../../src/panel/enrich.ts)).
- **`fetchPrStatus`**: `gh pr view --json state,number,url` with `cwd = worktreeRoot`. `gh pr view` (no arg) resolves the PR for that worktree's current branch. Parse JSON and normalize `state` (`OPEN`→`open`, `CLOSED`→`closed`, `MERGED`→`merged`). A non-zero exit (no PR for the branch, or a non-GitHub remote `gh` can't speak to) → `null`.
- **`ghIsAvailable`**: `gh auth status` exit 0 (binary missing → `ENOENT` → false). One call per snapshot drives `PanelSnapshot.prStatusAvailable` and short-circuits all per-worktree fetches when false.
- **Graceful degradation — every failure mode collapses to "PR state omitted, no error"** (the requirement, and the same shape as `degraded`): gh missing → `prStatusAvailable: false`, all `prStatus: null`; unauthenticated → same; non-GitHub remote → that worktree's `prStatus: null`; rate-limited → treated as unavailable for the cache window (the 60 s TTL means we never hammer the API). Every catch around the spawn ends in `null` plus, where useful, a debug log — never a thrown error or a non-200 response. The rare narrate-able failures carry `GITHUB_GH_UNAVAILABLE`/`GITHUB_PR_QUERY_FAILED` for logging; user-facing, gh's absence is silent. Swallows that are genuinely correct here carry a `// pw-allow-swallow: gh optional — absence is a valid state` comment per [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md).

## B-2. Main-vs-linked and clean/dirty

### Main-vs-linked — derived, no new git call beyond context

`detectGitWorktreeContext(worktreeRoot)` ([git.ts:46](../../../src/worktree/git.ts)) already returns `mainRoot` (= `worktreeRoots[0]`, since `git worktree list --porcelain` lists the main checkout first, [git.ts:73-74](../../../src/worktree/git.ts)). So `kind = normalizePath(worktreeRoot) === ctx.mainRoot ? 'main' : 'linked'`. **Derive from `mainRoot`, not the namespace** — `MAIN_NAMESPACE === 'main'` is overridable via `PORTWEAVE_NAMESPACE` ([decision-log #34](../../decision-log.md)), so it is an unreliable proxy for "is this the main checkout."

### Clean/dirty — new module `src/worktree/status.ts`

```typescript
/** Empty `git status --porcelain` ⇒ clean (true); any output ⇒ dirty (false);
 *  git failure ⇒ null (unknown). Catches staged + unstaged + untracked. */
export function worktreeIsClean(worktreeRoot: string): boolean | null
```

**It cannot reuse `runGit`** ([git.ts:92](../../../src/worktree/git.ts)): `runGit` returns `null` whenever stdout is empty ([git.ts:100](../../../src/worktree/git.ts)), but a **clean** tree's `git status --porcelain` is exactly empty-stdout-with-exit-0 — so `runGit` would conflate "clean" with "git failed." `status.ts` therefore does its own `spawnSync('git', ['status', '--porcelain'], { cwd: worktreeRoot, env: gitEnvForCwd(), encoding: 'utf-8' })` (reusing the exported `gitEnvForCwd()`, [git.ts:27](../../../src/worktree/git.ts)) and inspects `status` explicitly: `status === 0` → `result.stdout.trim() === ''`; non-zero → `null`. A `null` (unknown) result is treated as **not** clean by the safe-to-prune rule below — never assert "safe" on missing information.

## B-3. Safe-to-prune and the remove command — `src/panel/triage.ts`

Pure derivations (no I/O), unit-testable in isolation:

```typescript
export function deriveSafeToPrune(input: {
  readonly kind: WorktreeKind
  readonly prStatus: null | PanelPrStatus
  readonly workingTreeClean: boolean | null
}): boolean // kind === 'linked' && prState ∈ {merged,closed} && workingTreeClean === true

export function deriveRemoveCommand(worktreeRoot: string): string // `git worktree remove <shell-quoted root>`
```

`deriveSafeToPrune` is conservative by construction: the **main checkout is never safe** (`kind !== 'linked'`); a **PR-unknown** worktree is never safe (`prStatus` null — you cannot assert "done" without the PR signal, which is the whole motivation in the [feature's "Why"](../../features/panel-triage/panel-triage.md)); a **dirty** worktree is never safe (`workingTreeClean !== true`, including the `null`/unknown case). Each conjunct is an explicit AC. `deriveRemoveCommand` POSIX-single-quotes the path (a minimal quoter — wrap in `'…'`, escape embedded quotes) so a worktree path with spaces copies correctly; it always emits the **safe** (non-`--force`) form (see [B-9](#b-9-directory-removal--copy-the-command)).

## B-4. On-disk size — `src/panel/disk-size.ts`

```typescript
/** Worktree size in bytes via `du -sk`, or null when unavailable (non-du platform / failure). */
export function diskSizeBytes(worktreeRoot: string): Promise<null | number>
```

`du -sk <root>` (KB; ×1024 → bytes) is POSIX-portable (macOS/Linux) and far cheaper than a recursive JS walk. Use a non-blocking spawn (cold-cache `du` on a multi-GB `node_modules` can take seconds — must not block the loop or serialize). On **Windows** (`process.platform === 'win32'`) and on any `du` failure, return `null` (the frontend shows "—"). Always cached (B-5) — size is the most expensive per-worktree signal and changes slowly.

## B-5. Per-render cost — the cached triage provider

Today `buildPanelSnapshot` is synchronous-per-request: each `GET` re-reads the registry, re-loads configs, and re-probes ports in parallel ([enrich.ts:38-59](../../../src/panel/enrich.ts)) — cheap (liveness is ~250 ms, parallel). B-1/B-2/B-4 add three expensive per-worktree operations (`gh` network, `git status`, `du`). Running all three on every Refresh × N worktrees would make the panel sluggish and hammer the GitHub API.

**Decision: keep the registry read + liveness synchronous-per-request; put the three expensive signals behind an in-memory, TTL'd cache held by the long-lived server process.** New module `src/panel/triage-cache.ts`:

```typescript
export const PANEL_TRIAGE_TTL_MS = 60_000 as const // named constant for constants:check

export interface WorktreeTriage {
  readonly diskSizeBytes: null | number
  readonly kind: WorktreeKind
  readonly prStatus: null | PanelPrStatus
  readonly workingTreeClean: boolean | null
}

export interface TriageProvider {
  readonly prStatusAvailable: boolean // gh usable machine-wide (ghIsAvailable(), once)
  triageFor: (worktreeRoot: string) => Promise<WorktreeTriage> // cached, TTL 60 s
}

export function createTriageProvider(options?: {
  forceRefresh?: boolean
}): TriageProvider
```

- `triageFor(worktreeRoot)` returns the cached entry when fresh (`< 60 s`), else computes `{ kind, prStatus, workingTreeClean, diskSizeBytes }` (concurrently — gh + git status + du) and caches it. Keyed by `worktreeRoot`. **Liveness is NOT cached** — "is it running right now" must stay live.
- The provider is threaded into enrich through the existing **`EnrichDeps`** seam ([enrich.ts:34-36](../../../src/panel/enrich.ts)): add `triage?: TriageProvider`. `enrich` calls `deps.triage?.triageFor(...)` per worktree inside its existing `Promise.all`, stamps the four fields plus the derived `safeToPrune`/`removeCommand` onto each `PanelWorktree`, and sets `PanelSnapshot.prStatusAvailable = triage.prStatusAvailable` and `launchSupported = process.platform === 'darwin'`. Tests inject a stub provider (no real spawns), exactly as they inject `probe` today.
- **The server owns one provider instance** (created in `startPanelServer`, holding the cache for the process lifetime) and passes it on every request — so the cache actually persists across Refreshes. A `buildPanelSnapshot(env)` call with no injected provider creates a cold one (fine for one-off/CLI use). **No disk persistence** — the cache dies with the server, preserving no-daemon ([decision-log #3](../../decision-log.md)).
- **Refresh model:** keep the existing manual Refresh (no auto-poll/SSE, consistent with [02-frontend.md](../management-panel/02-frontend.md)). Add a **force-bypass**: `GET /api/allocations?refresh=1` constructs the snapshot with `forceRefresh: true` so the user can re-check immediately after merging a PR or deleting files instead of waiting out the TTL. The first request after server start pays the full cold cost (a deliberate user action) — accepted for v1; progressive/streamed enrichment is explicitly out of scope.

## B-6. Prune — the first registry write

### Shared write path: `src/panel/prune.ts`

```typescript
import type { AllocationKey } from '../worktree/key.ts'

/** Removes the allocation for `key`. removed=false when no entry matched. */
export function pruneAllocation(
  key: AllocationKey,
  env: NodeJS.ProcessEnv,
): Promise<Result<{ readonly removed: boolean }, PortweaveError>>
```

Reuses the existing locked read-modify-write primitive verbatim — **no hand-edited JSON** ([decision-log #44](../../decision-log.md)):

```typescript
return withRegistry((handle) => {
  const matched = handle.entries.some((e) => keysEqual(e.key, key))
  handle.remove(key) // src/registry/storage.ts:42 — filters by keysEqual, sets mutated only if length changed
  return { removed: matched }
}, env)
```

Both the CLI command and the panel route import `pruneAllocation` — **one prune code path** (DRY, dupcheck-friendly). `keysEqual` matches on `worktreeRoot` + `namespace` + `gitCommonDir` ([storage.ts:23-29](../../../src/registry/storage.ts)) — note it ignores `offsetOverride`, so a key from `resolveAllocationKey(cwd)` matches the stored entry regardless of any `PORTWEAVE_OFFSET`.

**`withRegistry` also prunes stale (deleted-dir) entries on every call** and persists if anything changed ([storage.ts:125-142](../../../src/registry/storage.ts)). So a prune call may also opportunistically drop _other_ deleted-dir entries — acceptable for a deliberate mutating action, but it means the AC "leaves all other entries unchanged" is precisely **all other _valid_ (non-stale) entries**. Tests seed only valid siblings to keep the assertion non-flaky, and the behavior is documented.

### CLI: `src/cli/prune.ts` (modeled on [src/cli/show.ts](../../../src/cli/show.ts))

```typescript
export interface PruneOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  path?: string // prune a different worktree without cd-ing
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
}
export interface PruneOutcome {
  readonly exitCode: number
}

export async function runPrune(
  options: PruneOptions,
): Promise<Result<PruneOutcome, PortweaveError>>
export function registerPruneCommand(program: Command): void
```

- **Target selection** mirrors `runShow` ([show.ts:118-130](../../../src/cli/show.ts)): default target is the current worktree via `resolveAllocationKey(options.path ?? cwd)` ([key.ts:18](../../../src/worktree/key.ts)) — symmetric with `portweave show`. `--path <dir>` resolves the key from another directory. **No stale/merged-PR heuristic** — `prune` always targets one explicit, user-named worktree (auto-pruning is out of scope, [feature doc](../../features/panel-triage/panel-triage.md)).
- Call `pruneAllocation(key, env)`. `removed: true` → print a one-line confirmation to stderr, exit 0. `removed: false` → "no allocation for this worktree" message and exit 1, reusing `CLI_NO_ALLOCATION` (`PW0603`), the same shape as `show`'s no-allocation path ([show.ts:154-160](../../../src/cli/show.ts)).
- **Works with the panel closed** — it is a standalone CLI command hitting `withRegistry` directly; no server involved.
- `registerPruneCommand(program)` wires `portweave prune [--path <dir>]`, added to [src/cli.ts](../../../src/cli.ts) alongside `registerShowCommand`/`registerPanelCommand` (one line).

### Panel route — `POST /api/prune`

Behind the [security model](#b-7-security-model-for-mutating-routes). Body: the target `AllocationKey` fields (`{ worktreeRoot, namespace, gitCommonDir }`) plus `confirm: true`. The handler reads + JSON-parses the body (a small size-capped `readJsonBody(req)` helper — `node:http` does not parse bodies), enforces `confirm === true` (else `400`), calls the identical `pruneAllocation(key, env)`, and returns `{ removed }` JSON. The frontend then re-fetches the snapshot (force-refresh) so the pruned worktree disappears.

### Preserving the read-only invariant

This is the delicate part. The existing byte-identical-after-`GET` test ([server.test.ts test 16](../../../src/panel/__tests__/server.test.ts)) stays **green and unchanged** — `GET /api/allocations` still uses `readRegistryEntries` ([enrich.ts:44](../../../src/panel/enrich.ts)), so reads never write. The new mutating route is a different method+path. The routing-matrix test (test 17, "`POST /api/allocations` → 405") **must be updated**: `POST` is no longer universally 405 now that `POST /api/prune` / `POST /api/open` exist — update it to the new matrix (`POST /api/prune` valid; `GET` on it 405; bad-origin/no-token → 403). Add a **new** test asserting the prune route actually writes (the targeted entry is gone, valid siblings intact) while `GET` stays byte-identical. The spec frames this explicitly: **the read-only invariant is now scoped to the read routes; the mutating route is the deliberate, audited exception** (the [#44 refinement](./panel-triage.md#decision-log-impact)). An implementer must never "fix" test 16 to permit writes on the read path.

## B-7. Security model for mutating routes

The panel is an **unauthenticated `127.0.0.1` server** — but loopback is **not** a security boundary against a malicious/compromised web page: any page open in the user's browser can `fetch`/form-POST to `http://127.0.0.1:7733` (CSRF), and DNS-rebinding can point an attacker domain at `127.0.0.1`. So the moment a mutating route exists it needs protection. New module `src/panel/security.ts`:

```typescript
import type { IncomingMessage } from 'node:http'

export interface PanelSecurity {
  readonly csrfToken: string // crypto.randomBytes(32).toString('hex'), once per server
  /** 403-gate for mutating requests: Host + Origin allowlist AND CSRF-header match. */
  authorizeMutation: (req: IncomingMessage) => boolean
}

export function createPanelSecurity(boundPort: number): PanelSecurity
```

Layers (defense in depth):

1. **`Host`/`Origin` allowlist (anti-DNS-rebinding + anti-CSRF first line).** Reject (`403`) any mutating request unless `Host ∈ {127.0.0.1:<port>, localhost:<port>}` **and** (when present) `Origin ∈ {http://127.0.0.1:<port>, http://localhost:<port>}`. A DNS-rebinding attacker's `Host` is their domain; a cross-site fetch carries their `Origin`. Built from `boundPort` (the actual listening port, known after `'listening'`).
2. **Per-session CSRF synchronizer token.** `createPanelSecurity` mints a random `csrfToken` once. The server **injects it into the served `index.html`** (`<meta name="pw-csrf" content="…">`); the frontend reads it and sends it as `X-Portweave-CSRF` on every mutating fetch. The server rejects (`403`) mutating requests whose header ≠ the token. A cross-origin attacker cannot read the token (same-origin policy blocks reading the HTML body), so cannot forge the header.
3. **Server-side confirmation for destructive actions.** Prune requires `confirm: true` in the body (`400` without) — belt-and-suspenders on top of CSRF that also forces the frontend to show a confirm dialog. `POST /api/open` (non-destructive) needs layers 1–2 but not `confirm`.

Routing matrix:

| Route              | Method | Mutating        | Host/Origin | CSRF token                        | confirm      |
| ------------------ | ------ | --------------- | ----------- | --------------------------------- | ------------ |
| `/api/allocations` | GET    | no              | —           | —                                 | —            |
| `/` , assets       | GET    | no              | —           | — (`/` now **injects** the token) | —            |
| `/api/prune`       | POST   | **yes**         | required    | required                          | **required** |
| `/api/open`        | POST   | **yes** (spawn) | required    | required                          | —            |

**Server changes** ([src/panel/server.ts](../../../src/panel/server.ts)): `createHandler` currently 405s every non-`GET` ([server.ts:161-168](../../../src/panel/server.ts)); it gains a `POST` branch dispatching to the gated handlers. The `/` static handler ([server.ts:136-146](../../../src/panel/server.ts)) changes from a raw `createReadStream` ([server.ts:127-134](../../../src/panel/server.ts)) **for `index.html` only** to read-substitute-send (inject the token); hashed assets still stream unchanged, and the `503`-when-unbuilt branch is preserved (no HTML ⇒ nothing to inject ⇒ still 503). New codes `PANEL_REQUEST_FORBIDDEN` (`PW0605`, covers Host/Origin + CSRF rejection; message distinguishes) and `PANEL_PATH_NOT_ALLOWED` (`PW0606`, B-8).

The `security-review` gate (run by `execute-spec`) will scrutinize this hard — the Problem/Approach must state "loopback ≠ security boundary" explicitly so the layers don't read as over-engineering.

## B-8. Quick actions — macOS launch (editor + terminal)

`POST /api/open`, behind the security model. Body: `{ target: 'editor' | 'terminal', worktreeRoot }`. New module `src/panel/launch.ts`:

```typescript
export interface LaunchResult {
  readonly launched: boolean
  readonly reason?: string
}
export function launchAt(
  target: 'editor' | 'terminal',
  worktreeRoot: string,
): Promise<LaunchResult>
```

- **macOS only for v1.** `process.platform !== 'darwin'` → `{ launched: false, reason: 'unsupported-platform' }` (a graceful, non-error response; the frontend hides launch buttons when `snapshot.launchSupported` is false, so this is a defensive fallback). Windows/Linux launchers are left for future contributors.
- **Launchers (macOS):** terminal = `open -a Terminal <path>`; editor = `$PORTWEAVE_EDITOR <path>` if set, else `code`/`cursor` on PATH, else `open -a "Visual Studio Code" <path>`, else `{ launched: false, reason: 'no-editor-found' }`.
- **Security-critical:** spawn via an **argv array, never a shell** (a worktree path with shell metacharacters must not inject a command); and **validate `worktreeRoot` against the known allocation roots** (read via `readRegistryEntries`) before launching — the route must refuse to open an arbitrary directory (`PANEL_PATH_NOT_ALLOWED`, `PW0606`). A spawn/launcher-not-found failure surfaces as `PANEL_LAUNCH_FAILED` (`PW0607`).
- **#34 note:** launching an external editor/terminal at a path is **not** managing a service's lifecycle (no start/stop of the user's dev servers), so it stays on the right side of [decision-log #34](../../decision-log.md). One sentence in the module / decision-log row makes this explicit.

A "copy path" affordance is pure frontend (selectable text / clipboard) — no route.

## B-9. Directory removal — copy-the-command

The panel surfaces the exact `git worktree remove <root>` string (the backend-constructed `removeCommand` field, B-3, correctly shell-quoted) for the user to copy and run. **The panel never executes filesystem removal.** When the tree is dirty (`workingTreeClean === false`), the frontend additionally shows the `git worktree remove --force <root>` variant **with a warning**, never auto-applied — `removeCommand` itself always carries the safe (non-force) form. Executing removal (behind the security model + an irreversibility guard) is explicitly deferred to a future spec; the door is documented but closed for v1.

## New PW error codes

Added to `PW_ERROR_CODES` ([src/errors.ts:3-22](../../../src/errors.ts)) — the object is perfectionist-sorted by key, so each slots in alphabetically. Final numbers reconcile against actual free slots at implementation per [decision-log #17](../../decision-log.md) (never renumber a published code).

| Proposed name             | Code     | Block        | Use                                                                             |
| ------------------------- | -------- | ------------ | ------------------------------------------------------------------------------- |
| `GITHUB_GH_UNAVAILABLE`   | `PW0801` | GitHub (new) | gh missing/unauthenticated (mostly internal/logging — swallowed)                |
| `GITHUB_PR_QUERY_FAILED`  | `PW0802` | GitHub (new) | `gh pr view` failed for a reason other than "no PR" (logging)                   |
| `PANEL_REQUEST_FORBIDDEN` | `PW0605` | CLI/panel    | mutating request rejected — bad Host/Origin or missing/invalid CSRF token (403) |
| `PANEL_PATH_NOT_ALLOWED`  | `PW0606` | CLI/panel    | mutating request targeting a path that is not a known allocation root           |
| `PANEL_LAUNCH_FAILED`     | `PW0607` | CLI/panel    | editor/terminal spawn failed / launcher not found (macOS)                       |

Prune "nothing to remove" reuses `CLI_NO_ALLOCATION` (`PW0603`); registry failures bubble from `withRegistry` as `REGISTRY_LOCKED`/`REGISTRY_CORRUPT`. A distinct `REGISTRY_PRUNE_FAILED` (`PW0303`, next free in the registry block) is **not** added unless a prune-specific persist failure emerges.

## Frontend changes (`panel/` — no backend gate)

Built on 01's collapsible `WorktreeCard`:

- **PR badge** per worktree (`open`/`closed`/`merged`, colored) when `prStatus` is set; hidden when null. A single "PR status unavailable — install/auth `gh`" hint when `prStatusAvailable` is false (not N empty badges).
- **Disk size** rendered human-readable from `diskSizeBytes` (or "—" when null).
- **Safe-to-prune marker** when `safeToPrune` (e.g. a "✓ safe to prune" pill); the main checkout shows a "main" tag and never the marker.
- **Prune button** → confirm dialog → `POST /api/prune` with the `X-Portweave-CSRF` header and `confirm: true` → on `removed: true`, re-fetch with `?refresh=1`.
- **Copy `removeCommand`** button; when dirty, also the `--force` variant with a warning.
- **Launch buttons** (editor, terminal) shown only when `snapshot.launchSupported` → `POST /api/open` with the CSRF header. **Copy path** button always.
- Reads the CSRF token from the injected `<meta name="pw-csrf">`. The duplicated `panel/src/types.ts` gains the same additive fields; drift is caught by the server contract test.

## Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md): real I/O against `os.tmpdir()`, real `git init`/`git worktree add` (the worktree-context test pattern), `XDG_CONFIG_HOME`-isolated registry, injected stubs for the gh/spawn boundary so CI never depends on a real authenticated `gh`.

- **`src/worktree/__tests__/status.test.ts`** — `worktreeIsClean`: clean `git init` repo → `true`; after writing an untracked file → `false`; after a staged change → `false`; non-git dir → `null` (proves the clean-vs-failure distinction `runGit` couldn't make).
- **`src/github/__tests__/pr-status.test.ts`** — with the spawn boundary injected: `OPEN`/`CLOSED`/`MERGED` JSON → normalized states; non-zero exit (no PR) → `null`; `ENOENT` (gh absent) → `ghIsAvailable() === false` and `fetchPrStatus` → `null`, no throw.
- **`src/panel/__tests__/triage.test.ts`** — `deriveSafeToPrune`: linked+merged+clean → true; main+merged+clean → false; linked+open+clean → false; linked+merged+dirty → false; linked+merged+`null`-clean → false; linked+`null`-PR → false. `deriveRemoveCommand`: quotes a path with spaces.
- **`src/panel/__tests__/disk-size.test.ts`** — real tmpdir with known files → a positive byte count (loose lower-bound assertion); platform-skip on Windows.
- **`src/panel/__tests__/triage-cache.test.ts`** — `triageFor` computes on miss, returns cached within TTL (assert the underlying stubs called once), recomputes after TTL / under `forceRefresh`.
- **`src/panel/__tests__/enrich.test.ts`** (extend) — with a stub `TriageProvider`: `PanelWorktree` carries `kind`/`prStatus`/`workingTreeClean`/`diskSizeBytes`/`safeToPrune`/`removeCommand`; `prStatusAvailable`/`launchSupported` set on the snapshot.
- **`src/panel/__tests__/security.test.ts`** — `authorizeMutation`: good Host+Origin+token → true; bad Host → false; cross-origin → false; missing/wrong token → false.
- **`src/panel/__tests__/server.test.ts`** (extend) — `POST /api/prune` with good origin+token+confirm removes the targeted entry, valid siblings intact; without token → 403; bad Origin → 403; without `confirm` → 400; **`GET` stays byte-identical (test 16 intent intact)**; routing-matrix test updated; served `/` HTML carries the `pw-csrf` meta tag (token injection).
- **`src/panel/__tests__/prune.test.ts`** — `pruneAllocation` removes the matched key (`removed: true`), returns `removed: false` for an absent key, leaves valid siblings unchanged.
- **`src/cli/__tests__/prune.test.ts`** — `runPrune` prunes the cwd's allocation (exit 0); `--path` prunes another worktree; no-allocation → exit 1 with `CLI_NO_ALLOCATION`; works with no server running; `registerPruneCommand` registers `prune` + `--path` (duck-typed commander stub, same pattern as `show.test.ts`).

Coverage: 80% statements/branches/functions/lines ([vitest.shared.ts](../../../vitest.shared.ts)) on all new `src/**` modules.

## Acceptance criteria (this layer)

See the [index roll-up](./panel-triage.md#part-b--write-actions--triage-02). Load-bearing:

- [ ] `src/github/pr-status.ts` exports `ghIsAvailable()` + `fetchPrStatus(worktreeRoot)`; PR state shows when gh is present+authed, and gh missing/unauthed/non-GitHub/rate-limited all render fully with `prStatus` omitted and `prStatusAvailable: false`, no error. Verified by `pr-status.test.ts` + extended `enrich.test.ts`.
- [ ] `kind` is `main` only for the main checkout (`mainRoot` comparison, not namespace); `worktreeIsClean` distinguishes clean/dirty/unknown. Verified by `status.test.ts` + `enrich.test.ts`.
- [ ] `safeToPrune` is true iff linked **and** PR merged/closed **and** working tree clean; main never; PR-unknown never; dirty never. Verified by `triage.test.ts`.
- [ ] Each worktree exposes `diskSizeBytes` (or null off-`du`); cached. Verified by `disk-size.test.ts` + `triage-cache.test.ts`.
- [ ] `portweave prune` removes exactly the targeted allocation (cwd or `--path`), leaves valid siblings unchanged, works with the panel closed, exits 1 with `CLI_NO_ALLOCATION` when nothing matches. Verified by `prune.test.ts` + `cli/__tests__/prune.test.ts`.
- [ ] The panel's `POST /api/prune` uses the identical `pruneAllocation` path and writes; `GET` stays byte-identical (test 16 intact); routing-matrix test updated. Verified by extended `server.test.ts`.
- [ ] Mutating requests are gated: bad Host/Origin → 403, missing/invalid CSRF token → 403, prune without `confirm` → 400; the served `/` injects the CSRF token; `GET` routes unaffected. Verified by `security.test.ts` + `server.test.ts`.
- [ ] `removeCommand` is a correctly-quoted, copyable `git worktree remove <root>`; never executed; `--force` shown only with a dirty-tree warning. Verified by `triage.test.ts` + manual smoke.
- [ ] Quick actions launch editor + terminal at a worktree root on macOS via the gated `POST /api/open` (argv-array spawn, path validated against allocation roots); non-macOS returns a graceful no-op and the UI shows the path. Verified by a `launch.ts` test (injected spawn) + `server.test.ts` (gate + path validation).
- [ ] New PW codes added in the correct blocks; no published code renumbered. Verified by referencing them in the above tests.
- [ ] `npm run dev-workflow` green; all new `src/**` modules meet 80% coverage; `enrich.ts`/`server.ts` stay under the 250-line cap (logic in the new helper modules).

## Open questions

**None blocking** — all feature-doc questions are resolved above (gh module → `src/github/`; TTL 60 s; CSRF scheme; prune target = cwd/`--path`; launch macOS-only; directory removal = copy-the-command). Two minor judgment calls left to implementation, neither blocking:

- **gh module placement** — `src/github/pr-status.ts` (own `PW08xx` block) is recommended over `src/panel/github.ts` for the clean error-block boundary and future reuse; revisit only if it never grows past PR status.
- **Error-code consolidation** — `PANEL_REQUEST_FORBIDDEN` covers both Host/Origin and CSRF rejection; split into two codes only if diagnostics warrant it at implementation time.
