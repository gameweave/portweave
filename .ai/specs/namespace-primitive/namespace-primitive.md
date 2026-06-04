# Namespace as a first-class primitive

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/namespace-primitive/namespace-primitive.md](../../features/namespace-primitive/namespace-primitive.md)
**Decision-log rows:** [#41](../../decision-log.md) (runtime `namespace()` + reserved `${namespace}` token) — evolves [#34](../../decision-log.md) (the `${pw:*}` metadata sigil), [#35](../../decision-log.md) (runtime `.env`-override semantics)

## Problem

Portweave derives a stable per-worktree namespace and uses it everywhere
internally — it keys the registry under it ([src/worktree/key.ts](../../../src/worktree/key.ts)),
stores it on every allocation as `allocation.namespace`, and injects it as the
authoritative `PORTWEAVE_NAMESPACE` ([src/env/resolve.ts](../../../src/env/resolve.ts)).
The namespace is precisely the primitive a project needs to keep worktrees from
colliding in **non-port** resources (PM2 process names, DB table prefixes, S3 /
registry key prefixes, cache dirs). Portweave isolates ports automatically; the
namespace is how a consumer isolates everything else with the same key.

But the namespace was only reachable two ways, each ill-suited to that job:

1. `allocation().value.namespace` — surfaces the namespace, but runs the full
   allocate pipeline (registry lock + port probe + `.portweave/current.env`
   write). Far heavier than "what is this worktree's name?".
2. `process.env.PORTWEAVE_NAMESPACE` — only set inside a `portweave run` child;
   invisible to a JS/TS config, a build script, or any tool that runs outside
   `portweave run`.

And inside `portweave.config.json` there was no bare reference: `${pw:namespace}`
worked, but `${namespace}` was treated as a service-port ref and errored
(`checkPlaceholder`, [src/config/schema.ts](../../../src/config/schema.ts)).

The motivating case is a monorepo replacing a homegrown per-worktree allocator
that exposed `{ namespace, offset, root }` and keyed PM2 names and DB / registry
prefixes on the namespace. Portweave covers ports; this spec gives adopters the
first-class, ergonomic, declarative namespace access needed to cover the rest,
so the homegrown allocator can be retired.

Both changes are additive and target 0.3.3+: `namespace()` rides on the
cwd-stable-namespace (git-common-dir) fix so it is reliable from subdirectories.

## Approach

Two surfaces, both thin layers over machinery that already exists.

### Ask 1 — runtime `namespace()` export

Add to [src/runtime/index.ts](../../../src/runtime/index.ts), alongside
`ports()` / `env()` / `allocation()`:

```typescript
export function namespace(
  opts?: PortsOptions,
): Promise<Result<string, PortweaveError>> {
  const cwd = resolvePath(opts?.cwd ?? process.cwd())
  const keyResult = resolveAllocationKey(cwd)
  return Promise.resolve(
    keyResult.ok ? ok(keyResult.value.namespace) : keyResult,
  )
}
```

- Resolves through `resolveAllocationKey` only — **no** `allocate()`, no
  registry lock, no port probe, no `.portweave/current.env` write, and **no
  config file required** (it never calls `resolveConfigForRuntime`). This is the
  lightweight path the feature wants; the full pipeline was rejected as
  needlessly heavy for surfacing a value the key already carries.
- Returns the identical value to `allocation().value.namespace` and the injected
  `PORTWEAVE_NAMESPACE` for the same `cwd`, because all three derive from
  `resolveAllocationKey(cwd).namespace` (the allocator copies `key.namespace`
  onto the entry, and `keysEqual` compares it, so a reused entry agrees too).
- Honors the `PORTWEAVE_NAMESPACE` override (via `namespaceOverride()` inside
  `resolveAllocationKey`) and the `cwd` option, same precedence as the rest of
  the runtime. `configPath` / `count` are accepted (shared `PortsOptions`) but
  inert — documented.
- Non-`async` returning a `Promise` (matching the feature's stated signature):
  the body has nothing to await, and an `async`-with-no-`await` function would
  trip `@typescript-eslint/require-await` under `strictTypeChecked`.
- **cwd-stability** rides on `git rev-parse --show-toplevel` /
  `--git-common-dir` in `detectGitWorktreeContext`, which return the same
  worktree root from any subdirectory. A dedicated test guards it.

### Ask 2 — reserved `${namespace}` template token

A single shared constant in [src/env/metadata.ts](../../../src/env/metadata.ts)
(the metadata grammar's single source of truth) backs both the runtime evaluator
and the load-time validator, so they cannot drift:

```typescript
export const RESERVED_NAMESPACE_TOKEN = 'namespace'
// PW_METADATA_FIELDS references the constant rather than repeating the literal
// (sonarjs/no-duplicate-string, threshold 2).
```

- [src/env/templates.ts](../../../src/env/templates.ts) — `evaluateTemplate`
  checks `name === RESERVED_NAMESPACE_TOKEN` **first**, before the `${pw:*}`
  branch and the service-port lookup, and resolves it from `metadata.namespace`
  (factored into a `resolveMetadataField` helper shared with the `${pw:*}`
  path). Checking first is what makes the token _reserved_ — it wins over a
  service literally named `namespace`.
- [src/config/schema.ts](../../../src/config/schema.ts) — `checkPlaceholder`
  returns early (valid) for the reserved token, so a config using `${namespace}`
  passes validation whether or not a service named `namespace` exists.
- Everything else is unchanged: `${serviceName}` still resolves to the allocated
  port, `${pw:<field>}` still resolves metadata, and an unknown non-reserved
  token still errors (`CONFIG_INVALID` at load, `ENV_BUILD_INVALID` at runtime).
  No new error codes.

**Collision rule (decision):** `${namespace}` is reserved and always means the
worktree namespace. A service may still be named `namespace` (its port is still
allocated and exposed through its own `envVar`); only the `${namespace}`
_template token_ is shadowed. This evolves [decision-log #34](../../decision-log.md),
which chose the colon-prefixed `${pw:*}` sigil specifically to stay
collision-free with a service named `namespace`; #41 adds the bare alias for
ergonomics and resolves the collision by reservation. Only `namespace` is
reserved as a bare token — `${worktreeRoot}` / `${gitCommonDir}` still require
the `${pw:*}` prefix.

### Test layout

Real I/O against `os.tmpdir()` per [.claude/rules/testing.md](../../../.claude/rules/testing.md);
git-worktree fixtures reuse the helpers in `src/worktree/__tests__/_helpers.ts`.
Tests extend existing source-paired files (no new test files, so
`structure:check` is satisfied):

- `src/env/__tests__/templates.test.ts` — `${namespace}` resolves; mixes with
  `${serviceName}`; equals `${pw:namespace}`; wins over a service named
  `namespace`; a bare `${worktreeRoot}` (non-reserved) still throws.
- `src/env/__tests__/build.test.ts` — `${namespace}` resolves inside
  `discoveryEnv` to `allocation.namespace`.
- `src/config/__tests__/schema.test.ts` — `${namespace}` validates; validates
  alongside a service named `namespace`.
- `src/runtime/__tests__/index.test.ts` — `namespace()` equals
  `allocation().namespace` and `env().PORTWEAVE_NAMESPACE`; returns `main`
  (non-git) and `<slug>-<hash>` (linked worktree); honors the override; resolves
  with no config and writes no `current.env`; surfaces a bad `PORTWEAVE_OFFSET`;
  is cwd-stable (root vs nested subdirectory); plus an `env()` integration test
  for a `${namespace}`-templated `discoveryEnv`.
- `src/cli/__tests__/run.test.ts` — `portweave run` injects a
  `${namespace}`-templated `discoveryEnv` value into the child and writes it to
  `current.env`.
- `src/runtime/__tests__/exports-smoke.test.ts` — the TS consumer imports
  `namespace` from the published types (gated behind `RUN_SMOKE_TESTS=1`).

### Docs

`README.md` (runtime API reference for `namespace()`; `${namespace}` in the
config template notes; an "Isolating non-port resources per worktree" section),
`schema/v1.json` (`discoveryEnv` description), `examples/gameweave.config.json`
(a `${namespace}` example), and the decision-log row.

## Acceptance criteria

- [x] `src/runtime/index.ts` exports `namespace(opts?): Promise<Result<string, PortweaveError>>`, resolving the per-worktree namespace via `resolveAllocationKey` alone — no allocation, registry lock, port probe, `current.env` write, or config file required.
- [x] `namespace()` returns the same value as `allocation().value.namespace` and the injected `PORTWEAVE_NAMESPACE` for the same `cwd`; honors the `PORTWEAVE_NAMESPACE` override and the `cwd` option. Verified by `src/runtime/__tests__/index.test.ts`.
- [x] `namespace()` returns `main` for the primary worktree and `<slug>-<hash>` for a linked worktree, and is identical from the worktree root and a nested subdirectory (cwd-stability regression guard). Verified by `src/runtime/__tests__/index.test.ts`.
- [x] `evaluateTemplate` resolves a reserved `${namespace}` token to the worktree namespace, mixes it with `${serviceName}` refs, treats it as equal to `${pw:namespace}`, and resolves it even when a service is named `namespace`; unknown non-reserved tokens still throw `ENV_BUILD_INVALID`. Verified by `src/env/__tests__/templates.test.ts` and `build.test.ts`.
- [x] The config loader accepts `${namespace}` (with or without a service named `namespace`) and still rejects unknown tokens with `CONFIG_INVALID`. Verified by `src/config/__tests__/schema.test.ts`.
- [x] `portweave run` injects a `${namespace}`-templated `discoveryEnv` value into the child and writes it to `.portweave/current.env`. Verified by `src/cli/__tests__/run.test.ts`.
- [x] No new PW error codes are introduced; both changes are additive (`${serviceName}` / `${pw:*}` templating and `ports()` / `env()` / `allocation()` are unchanged).
- [x] Coverage thresholds from `vitest.shared.ts` (80% across all four metrics) are met for the modified files.
- [x] `npm run dev-workflow` is green end-to-end.
- [x] One decision-log row (#41) appended capturing the runtime `namespace()` export and the reserved `${namespace}` token, including the collision rule and its lineage from #34.

## Open questions

- **`PORTWEAVE_OFFSET` coupling.** `namespace()` surfaces a malformed
  `PORTWEAVE_OFFSET` as `PW0202` because it shares `resolveAllocationKey`, even
  though the namespace does not depend on the offset. Resolved in favor of the
  shared lightweight path: it keeps `namespace()` identical to
  `allocation().value.namespace` in every case (including erroring identically),
  and the alternative — duplicating key resolution to skip offset parsing —
  buys little and risks drift. Documented on the function and in row #41.
- **Exports-smoke coverage of the new export.** This feature adds `namespace`
  to the TypeScript-consumer case in `exports-smoke.test.ts`, so the published
  `portweave/runtime` types are verified to include it. That smoke test was
  already hardened independently (it runs the repo's pinned compiler, not
  `npx tsc`, and pins `@types/node` in the consumer), so the addition is a
  one-line import with no further packaging work needed here.
