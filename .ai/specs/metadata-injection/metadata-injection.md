# Portweave metadata injection

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/metadata-injection/metadata-injection.md](../../features/metadata-injection/metadata-injection.md)
**Decision-log rows:** [#34](../../decision-log.md) (scope: process-mgmt out / identity primitive in; baseline + `${pw:*}` templating mechanism; authoritative `PORTWEAVE_NAMESPACE`)

## Problem

Portweave already derives a stable per-worktree namespace (`main` / `<slug>-<hash>`, [src/worktree/namespace.ts:19](../../../src/worktree/namespace.ts#L19)) and stores it on every allocation as `allocation.namespace` ([src/registry/types.ts:8](../../../src/registry/types.ts#L8)). That namespace is exactly the primitive a consumer needs to keep worktrees from colliding in a shared single-instance daemon (the canonical case: PM2 process names). DESIGN.md §7.2 row 4 and §7.3 step 5 promise it is "exposed via `PORTWEAVE_NAMESPACE` for PM2/log consumers" — but nothing injects it. [src/env/build.ts](../../../src/env/build.ts) emits only per-service `envVar` ports + resolved `discoveryEnv` templates, and `PORTWEAVE_NAMESPACE` is read only as an _input_ override ([src/worktree/namespace.ts:29](../../../src/worktree/namespace.ts#L29)). So a consumer under `portweave run` never sees the _derived_ value.

This spec closes that gap (an always-present `PORTWEAVE_NAMESPACE` baseline) and generalizes it (a `${pw:*}` template sigil so any portweave metadata can be surfaced under any env var name the user chooses). Portweave still never manages processes — it hands over the identity primitive and the consumer applies it.

## Approach

Two surfaces, both routed through the existing env layer so the [§5.2 two-consumption-modes contract](../../DESIGN.md) holds automatically (`buildEnvMap` output flows to both the injected child env _and_ `.portweave/current.env`, and is also what [`show --json`](../../../src/cli/show.ts) reports):

1. **Baseline** — `buildEnvMap` always emits `PORTWEAVE_NAMESPACE = allocation.namespace`.
2. **Templating** — a reserved `${pw:<field>}` placeholder, resolvable inside any `discoveryEnv` value alongside the existing `${serviceName}` port refs.

### New module: `src/env/metadata.ts`

Single source of truth for the metadata grammar, shared by the config validator and the runtime evaluator. Imports only `type { Allocation }` (type-only → no runtime import cycle with `config/`).

```typescript
import type { Allocation } from '../allocator/allocate.ts'

export const PORTWEAVE_NAMESPACE_VAR = 'PORTWEAVE_NAMESPACE'
export const PW_METADATA_PREFIX = 'pw:'

// 1:1 with AllocationKey identity fields. Each is a frozen public placeholder.
export type PwMetadataField = 'gitCommonDir' | 'namespace' | 'worktreeRoot'
export const PW_METADATA_FIELDS = [
  'gitCommonDir',
  'namespace',
  'worktreeRoot',
] as const satisfies readonly PwMetadataField[]

export function buildMetadata(
  allocation: Allocation,
): Record<PwMetadataField, string> {
  return {
    gitCommonDir: allocation.key.gitCommonDir ?? '', // null outside a git repo → ''
    namespace: allocation.namespace,
    worktreeRoot: allocation.key.worktreeRoot,
  }
}
```

**Field casing decision (resolves feature-doc open question):** camelCase (`worktreeRoot`, `gitCommonDir`), matching `AllocationKey` ([src/worktree/key.ts:11](../../../src/worktree/key.ts#L11)) 1:1 — no translation layer, and the field names are discoverable from the existing key shape.

### `src/env/templates.ts` — extend `evaluateTemplate`

Add a metadata param. A placeholder beginning with `pw:` resolves from metadata; otherwise it's a service-port ref (unchanged). The colon makes `pw:` collision-free — service names are kebab-case (`/^[a-z][a-z0-9-]*$/`, [schema.ts:5](../../../src/config/schema.ts#L5)) and cannot contain `:`.

```typescript
export function evaluateTemplate(
  template: string,
  ports: Readonly<Record<string, number>>,
  metadata: Readonly<Record<string, string>>,
): string {
  return template.replaceAll(PLACEHOLDER_PATTERN, (_, name: string) => {
    if (name.startsWith(PW_METADATA_PREFIX)) {
      const field = name.slice(PW_METADATA_PREFIX.length)
      if (!Object.hasOwn(metadata, field)) {
        throw new PortweaveError(
          PW_ERROR_CODES.ENV_BUILD_INVALID,
          `discoveryEnv template references unknown metadata field "${field}"`,
        )
      }
      return metadata[field]
    }
    if (!Object.hasOwn(ports, name)) {
      throw new PortweaveError(
        PW_ERROR_CODES.ENV_BUILD_INVALID,
        `discoveryEnv template references unknown service "${name}"`,
      )
    }
    return String(ports[name])
  })
}
```

The unknown-`pw:`-field throw is an invariant violation in practice (the config loader validates it up front, below) — defense-in-depth, mirroring the existing unknown-service throw. No new error code.

### `src/env/build.ts` — emit baseline + thread metadata

```typescript
export function buildEnvMap(
  allocation: Allocation,
  config: Config,
): Record<string, string> {
  const metadata = buildMetadata(allocation)
  const result: Record<string, string> = {
    [PORTWEAVE_NAMESPACE_VAR]: metadata.namespace, // baseline
  }
  for (const service of config.services) {
    // ...existing port assignment (unchanged)...
    for (const [discoveryKey, template] of Object.entries(
      service.discoveryEnv,
    )) {
      result[discoveryKey] = evaluateTemplate(
        template,
        allocation.ports,
        metadata,
      )
    }
  }
  return result
}
```

### `src/config/schema.ts` — validate `${pw:*}` at load time + reserve the prefix

`checkDiscoveryEnv` ([schema.ts:117](../../../src/config/schema.ts#L117)) currently rejects every placeholder not in `serviceNames`, so `${pw:namespace}` fails today. Update the placeholder loop: a placeholder starting with `pw:` is validated against `PW_METADATA_FIELDS` (unknown → `CONFIG_INVALID` error naming the bad field); other placeholders keep the service-name check.

Also reserve the output namespace: reject any user `envVar` or `discoveryEnv` key beginning with `PORTWEAVE_` (it would collide with portweave's reserved outputs). Add to `recordEnvVar` / `checkDiscoveryEnv` as a `CONFIG_INVALID` error. (Imports `PW_METADATA_FIELDS` / `PW_METADATA_PREFIX` from `../env/metadata.ts` — type-only-free value import, but `env/build.ts` only imports `config` types, so no runtime cycle.)

### Authoritative baseline — resolve the two-modes divergence (decision: option b)

`PORTWEAVE_NAMESPACE` is an authoritative _report_ of the namespace portweave used to allocate, not a user-tunable default. In both consumption modes it must equal `allocation.namespace`. The raw env value the user may have set is an _input_ portweave already consumed and sanitized via `namespaceOverride()` ([key.ts:43](../../../src/worktree/key.ts#L43)); echoing a different output would misreport what portweave keyed the registry under.

- **`current.env` path** — in [resolve.ts](../../../src/env/resolve.ts), after `applyDotenvOverrides`, re-assert `final[PORTWEAVE_NAMESPACE_VAR] = allocation.namespace` so a `.env` entry can't change the reported value.
- **Child-env path** — in [run.ts:161](../../../src/cli/run.ts#L161), after `mergedEnv = { ...resolvedEnv.env, ...io.env }`, re-assert `mergedEnv[PORTWEAVE_NAMESPACE_VAR] = resolvedEnv.env[PORTWEAVE_NAMESPACE_VAR]` so a raw/stale parent value can't shadow it.

This is a deliberate, documented exception to the general "process > .env > computed" precedence ([§7.2 row 9](../../DESIGN.md)), scoped to the reserved `PORTWEAVE_*` output. User-named discovery vars that _interpolate_ `${pw:*}` (e.g. `OTEL_SERVICE_NAME=gw-${pw:namespace}`) are ordinary vars under the user's key and keep normal precedence. (Option (a) — accept divergence and document it — was rejected: it lets the child name PM2 processes under a value different from the one portweave actually used.)

### Test layout

Real I/O against `os.tmpdir()` per [.claude/rules/testing.md](../../../.claude/rules/testing.md). Extend existing files:

- `src/env/__tests__/templates.test.ts` — `${pw:namespace}` / `${pw:worktreeRoot}` resolve from metadata; `${pw:gitCommonDir}` → `''` when null; mixed `gw-${pw:namespace}:${api}` resolves both halves; unknown `${pw:bogus}` throws `PW0501`.
- `src/env/__tests__/build.test.ts` — output always includes `PORTWEAVE_NAMESPACE === allocation.namespace`; discovery templates using `${pw:*}` resolve.
- `src/env/__tests__/metadata.test.ts` (new) — `buildMetadata` maps all three fields; null `gitCommonDir` → `''`.
- `src/config/__tests__/schema.test.ts` — `${pw:namespace}` passes validation; `${pw:bogus}` fails `CONFIG_INVALID`; a user `envVar: PORTWEAVE_NAMESPACE` (and a `PORTWEAVE_`-prefixed `discoveryEnv` key) fails `CONFIG_INVALID`.
- `src/env/__tests__/resolve.test.ts` — `current.env` contains `PORTWEAVE_NAMESPACE`; a `.env` line `PORTWEAVE_NAMESPACE=hijack` does **not** change it (authoritative).
- `src/cli/__tests__/run.test.ts` — child env carries `PORTWEAVE_NAMESPACE = allocation.namespace` even when the parent env sets a different raw `PORTWEAVE_NAMESPACE`.

### Docs (on `Status: in-progress`/`shipped`)

`README.md` (document `${pw:*}` + the baseline var), the JSON schema under `schema/` if it constrains `discoveryEnv`, DESIGN.md §7.2/§7.3 (mark the promise fulfilled), and `examples/gameweave.config.json` (demonstrate `${pw:namespace}`). Append the decision-log row.

## Acceptance criteria

- [ ] `src/env/metadata.ts` exports `buildMetadata`, `PW_METADATA_FIELDS`, `PW_METADATA_PREFIX`, `PORTWEAVE_NAMESPACE_VAR`, and `PwMetadataField`; `buildMetadata` maps `namespace`/`worktreeRoot`/`gitCommonDir` from the allocation, with null `gitCommonDir` → `''`. Verified by `src/env/__tests__/metadata.test.ts`.
- [ ] `buildEnvMap` output always contains `PORTWEAVE_NAMESPACE` equal to `allocation.namespace` (both `main` and `<slug>-<hash>` cases), verified by `src/env/__tests__/build.test.ts`.
- [ ] `evaluateTemplate` resolves `${pw:namespace}`, `${pw:worktreeRoot}`, and `${pw:gitCommonDir}` (→ `''` when null), supports mixing `${pw:*}` with `${serviceName}` in one template, and throws `PortweaveError` with `code === PW_ERROR_CODES.ENV_BUILD_INVALID` (`PW0501`) for an unknown `pw:` field. Verified by `src/env/__tests__/templates.test.ts`.
- [ ] The config loader accepts `${pw:<known-field>}` in `discoveryEnv` and rejects `${pw:<unknown-field>}` with `CONFIG_INVALID`; it rejects any `envVar` or `discoveryEnv` key beginning with `PORTWEAVE_`. Verified by `src/config/__tests__/schema.test.ts`.
- [ ] `PORTWEAVE_NAMESPACE` is authoritative: a project-root `.env` containing `PORTWEAVE_NAMESPACE=hijack` does not change the value written to `.portweave/current.env`, and a parent-process `PORTWEAVE_NAMESPACE=Raw Value` does not change the value injected into the child — both equal `allocation.namespace`. Verified by `src/env/__tests__/resolve.test.ts` and `src/cli/__tests__/run.test.ts`.
- [ ] Both consumption modes agree: after `portweave run`, the `PORTWEAVE_NAMESPACE` the child observed equals the `PORTWEAVE_NAMESPACE` line in `.portweave/current.env`.
- [ ] No new PW error codes are introduced (reuses `ENV_BUILD_INVALID` at runtime, `CONFIG_INVALID` at load time).
- [ ] Coverage thresholds from `vitest.shared.ts` (80% across all four metrics) are met for `src/env/metadata.ts` and all modified files.
- [ ] `npm run dev-workflow` is green end-to-end.
- [ ] Manual: in two worktrees of a scratch repo, `portweave run --verbose -- node -e "console.log(process.env.PORTWEAVE_NAMESPACE)"` prints `main` in the primary and `<slug>-<hash>` in a feature worktree; a config with `"OTEL_SERVICE_NAME": "gw-${pw:namespace}"` produces the interpolated value in the child and in `current.env`; running outside a git repo yields `${pw:gitCommonDir}` → `''` with no crash.
- [ ] One decision-log row appended capturing the scope split (process management out, identity primitive in) and the baseline + `${pw:*}` mechanism, including the authoritative-`PORTWEAVE_NAMESPACE` precedence exception.

## Open questions

- **`PORTWEAVE_OFFSET` / block base.** Deliberately excluded (feature doc): the per-project offset model was replaced by a global pool, and a base port is redundant with the first-class service-port vars. Re-open only if a concrete consumer need appears.
- **`${pw:gitCommonDir}` empty-string vs error outside git.** Spec chooses empty string so a shared config doesn't break when run outside a repo. Flagging in case review prefers a hard error for that placeholder specifically.
