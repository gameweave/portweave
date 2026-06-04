---
name: namespace-primitive
title: Namespace as a first-class primitive — runtime namespace() + reserved ${namespace} token
roadmap_ref: .ai/roadmaps/v0-roadmap.md # post-v0 enhancement; extends item 6 (env-resolution) and item 9 (library-runtime)
status: shipped # drafted | scoped | shipped | abandoned
---

# Namespace as a first-class primitive

## Why

Portweave already computes a stable per-worktree namespace (`main` for the
primary worktree, `<slug>-<hash>` otherwise — [src/worktree/namespace.ts:19](../../../src/worktree/namespace.ts#L19)),
exposes it on `allocation().value.namespace`, and injects it as
`PORTWEAVE_NAMESPACE` (re-asserted authoritatively in
[src/env/resolve.ts](../../../src/env/resolve.ts)). That namespace is exactly
the primitive a project needs to keep worktrees from colliding in resources that
are **not** ports: PM2 process names, database table prefixes, S3 / registry key
prefixes, cache directories. Distinct ports don't fix those — name uniqueness is
orthogonal to port uniqueness, the same gap [metadata-injection](../metadata-injection/metadata-injection.md)
identified for PM2.

But until now the namespace had only two access paths, each with a cost or a
constraint:

- **`allocation().value.namespace`** — digs the namespace out of a full
  allocation, which acquires the registry lock, probes ports, and writes
  `.portweave/current.env`. Far heavier than "tell me this worktree's name."
- **`process.env.PORTWEAVE_NAMESPACE`** — only set inside a `portweave run`
  child. A JS/TS config file, a build script, or a tool that runs outside
  `portweave run` never sees it.

And inside a `portweave.config.json` there was no bare way to reference the
namespace at all: `${pw:namespace}` worked, but the obvious `${namespace}` was
treated as a service-port reference and errored.

The motivating case is a monorepo replacing a homegrown per-worktree allocator.
That system exposed `{ namespace, offset, root }` and code keyed PM2 process
names on `-${namespace}` and per-worktree DB / registry prefixes on it.
Portweave fully covers the port side, but to retire the homegrown allocator the
adopter needs first-class, ergonomic, declarative access to the namespace to
cover the rest. Today the namespace is a byproduct of port allocation; this
feature makes it a primitive.

## Scope

**In scope:**

- A runtime `namespace(opts?)` export in `portweave/runtime`, alongside
  `ports()` / `env()` / `allocation()`, returning the resolved per-worktree
  namespace string. It resolves through `resolveAllocationKey` only — no port
  allocation, no registry lock, no `.portweave/current.env` write, no config
  file required — and honors the `PORTWEAVE_NAMESPACE` override and the `cwd`
  option with the same precedence as the rest of the runtime.
- A reserved `${namespace}` template token, usable in any `discoveryEnv` value
  alongside the existing `${serviceName}` and `${pw:*}` placeholders, that
  always resolves to the worktree namespace. It is a convenience alias for
  `${pw:namespace}`.
- cwd-stability: `namespace()` returns the same value from the worktree root and
  any subdirectory (riding on the 0.3.3 git-common-dir fix).

**Out of scope:**

- Any change to how the namespace is _derived_ — `deriveNamespace`,
  `namespaceOverride`, and the `PORTWEAVE_NAMESPACE` input override are
  untouched.
- Bare reserved tokens for the other metadata fields (`${worktreeRoot}`,
  `${gitCommonDir}`). Only `namespace` is reserved as a bare token; the others
  keep requiring the collision-free `${pw:*}` prefix. Re-open only if a concrete
  consumer need appears.
- Process management of any kind — Portweave still never names or manages PM2
  (or any other) processes. It hands over the identity primitive; the consumer
  applies it.

## Acceptance criteria sketch

- `import { namespace } from 'portweave/runtime'` resolves; `await namespace()`
  returns `main` in the primary worktree and `<slug>-<hash>` in a feature
  worktree, equal to `allocation().value.namespace` and the injected
  `PORTWEAVE_NAMESPACE` for the same `cwd`.
- `namespace()` succeeds with no `portweave.config.json` present and writes no
  `.portweave/current.env` (it does not allocate).
- `namespace()` is identical from the worktree root and a nested subdirectory.
- A `discoveryEnv` value like `"DDB_TABLE_PREFIX": "local-${namespace}"` resolves
  to `local-<namespace>` in both the `portweave run` child and
  `.portweave/current.env`, and mixes with `${serviceName}` port refs in one
  value.
- `${namespace}` is reserved: it resolves to the worktree namespace even when a
  service is literally named `namespace`; an unknown non-reserved token still
  errors.

## Open questions

- **Coupling to `PORTWEAVE_OFFSET`.** Because `namespace()` shares
  `resolveAllocationKey`, a malformed `PORTWEAVE_OFFSET` surfaces as `PW0202`
  even though the namespace does not depend on the offset. Accepted: it keeps
  `namespace()` identical to `allocation().value.namespace` in every case, and
  the lightweight shared path is preferred over duplicating key resolution.
