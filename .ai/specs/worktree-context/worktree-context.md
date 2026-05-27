# Worktree context, namespace derivation, and overrides

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/worktree-context/worktree-context.md](../../features/worktree-context/worktree-context.md)
**Decision-log rows:** [#9](../../decision-log.md) (allocation mechanism — keyed per-worktree), [#17](../../decision-log.md) (PW number-range scheme — this spec consumes the `PW0201–0299` block).

## Problem

Portweave's stickiness contract (DESIGN.md §5.4) is the load-bearing invariant the rest of the system relies on: the _same_ worktree must always resolve to the _same_ allocation across restarts, parallel terminals, and parallel coding agents — and two _different_ worktrees of the _same_ repo must always resolve to _different_ allocations so they can run side by side. Without that, the registry has no stable key to look up against, the allocator can't honor "same ports across restarts," and Gameweave's drop-in parity (DESIGN.md §7.3) is unreachable.

Today the codebase has the shared `Result<T, E>` primitive and `PortweaveError` (see [src/result.ts](../../../src/result.ts) and [src/errors.ts](../../../src/errors.ts)) but no worktree detection, no namespace derivation, and no `AllocationKey` shape for downstream features (`registry-storage`, `port-allocator`) to consume. This spec lands all three so Features 4 and 5 can begin against a real interface.

This feature also occupies the `PW0201–0299` slot of the error-code namespace established in decision-log row #17.

## Approach

Three source files under a new `src/worktree/` area, plus tests against real `git init` temp repos under `os.tmpdir()` (per [.claude/rules/testing.md](../../../.claude/rules/testing.md) — real I/O over mocks for boundary code). Public surface re-exported from [src/index.ts](../../../src/index.ts).

The shape is modeled on Gameweave's internal worktree-context detection and namespace-derivation helpers. Never import that prior art — rewrite under `src/worktree/` with `PORTWEAVE_*` substituted for Gameweave's `GAMEWEAVE_*`.

### `src/worktree/git.ts` — git-CLI detection

Mirrors Gameweave's internal git-detection helper exactly in shape:

- `gitEnvForCwd()` strips `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX` from a clone of `process.env` so a parent process's git state can't leak in (load-bearing — covered by an explicit test).
- `runGit(args, cwd)` shells out via `spawnSync('git', args, { cwd, env: gitEnvForCwd(), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })`; returns `null` on non-zero exit or empty stdout.
- `parseWorktreeRoots(output)` parses `git worktree list --porcelain` lines that start with `worktree ` and resolves each to an absolute path via `path.resolve`.
- `detectGitWorktreeContext(cwd): Result<GitWorktreeContext, PortweaveError>` runs `rev-parse --show-toplevel`, `rev-parse --git-common-dir`, and `worktree list --porcelain`. If any returns `null`, the function returns `err(new PortweaveError(PW_ERROR_CODES.NOT_A_GIT_REPO, ...))` so the caller knows to fall through to the cwd fallback path. Gameweave's `null`-on-failure convention is preserved at the helper layer but lifted into a `Result` at the public surface to match the project's error-handling contract ([.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md)).

```typescript
export interface GitWorktreeContext {
  currentRoot: string
  gitCommonDir: string
  mainRoot: string
  worktreeRoots: string[]
}
```

`mainRoot` is `worktreeRoots[0]` — git's porcelain output emits the main worktree first.

### `src/worktree/namespace.ts` — namespace derivation and env overrides

Mirrors Gameweave's internal namespace-derivation helper shape; substitutes env-var names and replaces the throw-on-bad-offset with a `Result`:

```typescript
export const MAIN_NAMESPACE = 'main'

const NAMESPACE_ENV = 'PORTWEAVE_NAMESPACE'
const OFFSET_ENV = 'PORTWEAVE_OFFSET'
const HASH_LENGTH = 8
const MAX_SLUG_LENGTH = 40
```

- `hashPath(path)` returns the first 8 hex chars of `sha1(absolutePath)`. **Matches Gameweave exactly** for migration debugging parity (per the feature-doc recommendation and roadmap pre-resolution).
- `sanitizeNamespace(value)` lowercases, replaces non-`[a-z0-9]+` runs with `-`, strips leading/trailing dashes, caps at 40 chars. Empty result falls back to `MAIN_NAMESPACE`.
- `deriveNamespace(currentRoot, mainRoot)` returns `MAIN_NAMESPACE` when `path.resolve(currentRoot) === path.resolve(mainRoot)`, otherwise `${sanitizeNamespace(basename(currentRoot))}-${hashPath(currentRoot)}`.
- `namespaceOverride()` reads `PORTWEAVE_NAMESPACE`, trims, runs through `sanitizeNamespace`, returns `null` when unset/empty.
- `parseExplicitOffset(): Result<null | number, PortweaveError>` reads `PORTWEAVE_OFFSET`. Unset/empty → `ok(null)`. Non-integer literal or out-of-range → `err(new PortweaveError(PW_ERROR_CODES.WORKTREE_OFFSET_INVALID, ...))`. Gameweave's `0–99` cap goes away (DESIGN.md §7.2 row 1 / §7.1: no 99-offset cap), but we keep an upper sanity bound: any non-negative integer that fits in `Number.MAX_SAFE_INTEGER` is accepted. The numeric value is _carried_ through `AllocationKey` so the allocator can honor it, but resolution of "what does an offset mean now that we're machine-wide pool?" is Feature #5's call — this spec only validates and propagates.

### `src/worktree/key.ts` — `AllocationKey` composer

```typescript
export interface AllocationKey {
  gitCommonDir: null | string
  namespace: string
  offsetOverride: null | number
  worktreeRoot: string
}

export function resolveAllocationKey(
  cwd: string,
): Result<AllocationKey, PortweaveError>
```

`resolveAllocationKey` is the public entry the rest of Portweave calls. Algorithm:

1. `path.resolve(cwd)` → `absoluteCwd`.
2. Try `detectGitWorktreeContext(absoluteCwd)`.
3. On `ok`, compose: `worktreeRoot = ctx.currentRoot`, `gitCommonDir = ctx.gitCommonDir`, base namespace = `deriveNamespace(ctx.currentRoot, ctx.mainRoot)`.
4. On `err(NOT_A_GIT_REPO)`, fall through to non-git path: `worktreeRoot = absoluteCwd`, `gitCommonDir = null`, base namespace = `deriveNamespace(absoluteCwd, absoluteCwd)` — which short-circuits to `MAIN_NAMESPACE` because `currentRoot === mainRoot`. This is the roadmap-pre-resolved "absolute cwd as allocation key" fallback.
5. On any _other_ `err` (e.g. an unexpected git failure that isn't `NOT_A_GIT_REPO`), propagate the `err` unchanged.
6. Apply `namespaceOverride()` — when set, replaces the derived namespace.
7. Apply `parseExplicitOffset()` — on `err`, propagate; on `ok(value)`, attach as `offsetOverride`.
8. Return `ok({ gitCommonDir, namespace, offsetOverride, worktreeRoot })`.

The resulting `AllocationKey` is what `registry-storage` will use to find/claim entries and what `port-allocator` will see for stickiness checks. The two strings `gitCommonDir` and `worktreeRoot` are always absolute, always normalized — that's the byte-identical-across-restarts contract (§5.4).

### Public re-export

[src/index.ts](../../../src/index.ts) gains named re-exports for `AllocationKey`, `GitWorktreeContext`, `MAIN_NAMESPACE`, `resolveAllocationKey`, `detectGitWorktreeContext`, `deriveNamespace`, `namespaceOverride`, `parseExplicitOffset`, and `sanitizeNamespace`. Downstream features import from `'portweave'` (or relative paths during build) rather than reaching into the `worktree/` subpath.

### New PW codes (slot into the `PW0201–0299` block)

Added to [src/errors.ts](../../../src/errors.ts) `PW_ERROR_CODES`:

- `NOT_A_GIT_REPO = 'PW0201'` — `detectGitWorktreeContext` couldn't get the three required pieces of git output. Not a hard error in user-facing flows (the cwd fallback handles it) but lets internal callers dispatch.
- `WORKTREE_OFFSET_INVALID = 'PW0202'` — `PORTWEAVE_OFFSET` was set to a non-integer literal or a negative value.

Per decision-log row #17, codes are assigned in addition order within a block; these are the first two slots used.

### Tests — `src/worktree/__tests__/`

Real-I/O against `os.tmpdir()` git repos. One file per source file:

`src/worktree/__tests__/git.test.ts`:

- Creates a temp repo with `spawnSync('git', ['init', ...])` (no commits required — `rev-parse --show-toplevel` works on an empty repo).
- Asserts `detectGitWorktreeContext` returns `ok` with `currentRoot`, `gitCommonDir`, `mainRoot`, `worktreeRoots` all populated and resolved to absolute paths.
- Creates a second worktree via `git worktree add ../<branch> -b <branch>`; asserts detection from inside that worktree returns the feature root as `currentRoot` and the original repo root as `mainRoot`, and that `worktreeRoots.length === 2`.
- Against a non-git temp dir, asserts `err(PortweaveError)` with `code === PW_ERROR_CODES.NOT_A_GIT_REPO`.
- `gitEnvForCwd` test: explicitly sets `GIT_DIR` in the parent process, calls `gitEnvForCwd()`, asserts the returned env object does not contain `GIT_DIR`. The actual `process.env` is restored after the test.
- `parseWorktreeRoots` unit test against a captured-string fixture covering the porcelain format (multiple `worktree ` lines separated by blank lines, intermixed `HEAD`/`branch` lines).

`src/worktree/__tests__/namespace.test.ts`:

- `deriveNamespace(mainRoot, mainRoot)` → `'main'`.
- `deriveNamespace('/tmp/foo-feature-x', '/tmp/foo')` → `feature-x-<8 hex chars>` where the hex is `sha1('/tmp/foo-feature-x').slice(0, 8)`. Asserted against an inline expected literal so any change to the hash algorithm/length is caught.
- Same path produces the same namespace across two calls (determinism).
- `sanitizeNamespace` collapses `feature/JL-123_fix!` → `feature-jl-123-fix`; empty input falls back to `'main'`; over-40-char input is truncated at 40.
- `namespaceOverride` reads `PORTWEAVE_NAMESPACE`, sanitizes (`'Foo Bar!'` → `'foo-bar'`); unset → `null`; whitespace-only → `null`. `process.env` mutated via `vi.stubEnv`, restored via `afterEach`.
- `parseExplicitOffset` returns `ok(null)` when unset, `ok(7)` for `'7'`, `err(PortweaveError with code WORKTREE_OFFSET_INVALID)` for `'7.5'`, `'abc'`, `'-1'`, and empty-after-trim values. No 99-offset cap — `'500'` returns `ok(500)`.

`src/worktree/__tests__/key.test.ts`:

- `resolveAllocationKey(repoRoot)` against a temp git repo: returns `ok` with `worktreeRoot === repoRoot`, `gitCommonDir` ending in `.git`, `namespace === 'main'`, `offsetOverride === null`.
- `resolveAllocationKey(featureWorktreeRoot)` against an added worktree: `namespace` matches `feature-x-<hash>` pattern, `worktreeRoot` is the feature root, `gitCommonDir` still points at the original repo's `.git` dir (this is the cross-worktree shared common dir).
- `resolveAllocationKey(nonGitTempDir)` → `ok` with `gitCommonDir === null`, `worktreeRoot === absoluteCwd`, `namespace === 'main'`.
- **Stickiness contract:** call `resolveAllocationKey` twice for the same worktree path; assert the two returned keys are deeply equal (verifies byte-identical-across-restarts per §5.4).
- **Distinctness contract:** call against the main worktree root and the feature worktree root of the same repo; assert their `AllocationKey` values are not deeply equal (different `worktreeRoot`, different `namespace`).
- `PORTWEAVE_NAMESPACE` set → final `namespace` reflects the sanitized override regardless of derived value.
- `PORTWEAVE_OFFSET=12` set → `offsetOverride === 12`; bad value → `err` with `WORKTREE_OFFSET_INVALID`.

A small helper `src/worktree/__tests__/_helpers.ts` (underscore prefix per existing convention if any; otherwise plain `helpers.ts`) wraps the temp-repo setup: `createTempGitRepo()` returns the root path and a `cleanup()` callback that `rm -rf`'s it. Used by `git.test.ts` and `key.test.ts` to avoid duplicated `spawnSync('git', ['init', ...])` boilerplate.

## Acceptance criteria

- [ ] `src/worktree/git.ts` exports `detectGitWorktreeContext(cwd): Result<GitWorktreeContext, PortweaveError>`, `gitEnvForCwd()`, `parseWorktreeRoots(output)`, `normalizePath(path)`, and the `GitWorktreeContext` interface — all with the shapes documented above.
- [ ] `detectGitWorktreeContext` against a fresh `git init` temp repo (no commits) returns `ok` with all four fields populated and absolute.
- [ ] `detectGitWorktreeContext` against a non-git temp directory returns `err` with `code === PW_ERROR_CODES.NOT_A_GIT_REPO`.
- [ ] `detectGitWorktreeContext` from inside a `git worktree add`'d feature worktree returns `currentRoot === featureRoot` and `mainRoot === originalRepoRoot`, with `worktreeRoots.length === 2`.
- [ ] `gitEnvForCwd()` strips `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX` from the returned env clone, verified by setting one of those vars in the test and asserting it's absent in the result.
- [ ] `src/worktree/namespace.ts` exports `MAIN_NAMESPACE`, `deriveNamespace`, `sanitizeNamespace`, `namespaceOverride`, and `parseExplicitOffset` with the documented shapes.
- [ ] `deriveNamespace(root, root)` returns `'main'`; `deriveNamespace('/tmp/foo-feature-x', '/tmp/foo')` returns a string of the form `feature-x-<8 lowercase hex chars>`, with the hex matching `sha1('/tmp/foo-feature-x').slice(0, 8)`.
- [ ] `deriveNamespace` is deterministic: two calls with the same arguments return the exact same string.
- [ ] `sanitizeNamespace` truncates at 40 chars, collapses non-`[a-z0-9]+` to `-`, strips leading/trailing dashes, and returns `MAIN_NAMESPACE` for an empty result.
- [ ] `PORTWEAVE_NAMESPACE` env var, when set to `'Foo Bar!'`, makes `namespaceOverride()` return `'foo-bar'`; when unset or whitespace-only, returns `null`.
- [ ] `parseExplicitOffset` returns `ok(null)` when `PORTWEAVE_OFFSET` is unset, `ok(<number>)` for any non-negative integer literal (no 99-cap), and `err(PortweaveError)` with `code === PW_ERROR_CODES.WORKTREE_OFFSET_INVALID` for non-integer, negative, or empty-after-trim values.
- [ ] `src/worktree/key.ts` exports `resolveAllocationKey(cwd): Result<AllocationKey, PortweaveError>` and the `AllocationKey` interface with fields `{ gitCommonDir: null | string, namespace: string, offsetOverride: null | number, worktreeRoot: string }`.
- [ ] `resolveAllocationKey` against a non-git directory returns `ok` with `gitCommonDir === null`, `worktreeRoot === path.resolve(cwd)`, `namespace === 'main'` (cwd-fallback path).
- [ ] `resolveAllocationKey` returns deeply-equal `AllocationKey` values for two calls against the same worktree path in the same process (stickiness contract — DESIGN.md §5.4).
- [ ] `resolveAllocationKey` returns _non-equal_ `AllocationKey` values when called against the main worktree root and a feature worktree root of the same repo (distinct-allocation contract).
- [ ] `PORTWEAVE_NAMESPACE` overrides the derived namespace in the final `AllocationKey`; `PORTWEAVE_OFFSET=12` populates `offsetOverride: 12`; a bad offset value surfaces as `err(PortweaveError)` from `resolveAllocationKey` itself (not a downstream throw).
- [ ] [src/errors.ts](../../../src/errors.ts) `PW_ERROR_CODES` gains `NOT_A_GIT_REPO: 'PW0201'` and `WORKTREE_OFFSET_INVALID: 'PW0202'`; existing seed codes from the result-types spec are unchanged.
- [ ] [src/index.ts](../../../src/index.ts) re-exports `AllocationKey`, `GitWorktreeContext`, `MAIN_NAMESPACE`, `detectGitWorktreeContext`, `deriveNamespace`, `namespaceOverride`, `parseExplicitOffset`, `resolveAllocationKey`, and `sanitizeNamespace`.
- [ ] Tests live under `src/worktree/__tests__/`, one `.test.ts` file per source file (per `structure:check` rule), driving real `git init` / `git worktree add` against `os.tmpdir()` temp dirs and cleaning them up afterward.
- [ ] All catch blocks (e.g. around `spawnSync` or fs cleanup) narrow `unknown` before reading properties and either log, rethrow, or produce a `Result` — no silent swallows without a `// pw-allow-swallow:` comment per [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md).
- [ ] `npm run dev-workflow` is green at the end of the feature, including `test` (with coverage thresholds met for the three new source files), `lint`, `typecheck`, `structure:check`, and `constants:check`.

## Open questions

- None blocking implementation. The roadmap pre-resolved hash format (match Gameweave's 8-char sha1), env-var prefix (`PORTWEAVE_NAMESPACE` / `PORTWEAVE_OFFSET`), and non-git fallback (absolute cwd as the key); those choices are baked into Approach above. Spec approval ratifies them — if the recommendation changes during review, update the relevant Approach paragraph and the corresponding acceptance-criteria line before promoting `Status: approved`.
