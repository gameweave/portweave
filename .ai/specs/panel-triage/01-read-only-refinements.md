# panel triage — Part A: read-only refinements

**Parent:** [panel-triage.md](./panel-triage.md) (index — Problem, consolidated AC, Decision-log impact, Open questions)
**Sibling:** [02-write-actions-triage.md](./02-write-actions-triage.md) (the write/triage half this is independent of)

This sub-spec owns the read-path UX refinements: a synthesized clickable link for **every** service, and collapsible, locally-persisted project/worktree groups. It adds **no new routes and no security surface**, preserves the read-only invariant, and is independently shippable. Land it before [02](./02-write-actions-triage.md).

## A-1. Every service is a clickable link

Today `healthy()` builds `links` only from a service's `discoveryEnv` keys, filtered through `isSafeLinkUrl` ([src/panel/enrich.ts:116-128](../../../src/panel/enrich.ts)); a service whose config declares no `http(s)` discovery URL ends up with `links: []` and renders as a non-clickable port chip ([02-frontend.md](../management-panel/02-frontend.md)). The refinement: when a service has no explicit `http(s)` link, synthesize `http://localhost:<allocated-port>` so it is always one click from a preview.

### New module: `src/panel/service-links.ts`

`enrich.ts` is at 219/250 lines ([config/eslint/complexity-rules.ts](../../../config/eslint/complexity-rules.ts), `max-lines: 250`, `skipComments: false`), and this is a cohesive, separately-testable pure function — so it lands as its own small module, mirroring the [`links.ts`](../../../src/panel/links.ts) / [`labels.ts`](../../../src/panel/labels.ts) extraction pattern.

```typescript
import type { PanelLink } from './types.ts'
import { isSafeLinkUrl } from './links.ts'

// Given a service's already-safe explicit links (its discoveryEnv URLs that
// passed isSafeLinkUrl) and its allocated port, guarantee at least one
// browser-openable link: if no explicit http(s) link exists, append a
// synthesized http://localhost:<port>. An explicit http(s) discovery URL wins
// (it is the configured, intentional preview URL); ws/wss explicit links are
// preserved alongside the synthesized one (they are not browser previews).
export function resolveServiceLinks(
  explicit: readonly PanelLink[],
  port: number,
): readonly PanelLink[]
```

Logic:

1. If any link in `explicit` has scheme `http:` or `https:`, return `explicit` unchanged.
2. Otherwise build `synthesized = { envVar: '', url: \`http://localhost:${port}\` }`and return`[...explicit, synthesized]`— but only when`Number.isInteger(port)`and`isSafeLinkUrl(synthesized.url)`. The synthesized scheme is always `http`, so `isSafeLinkUrl`passes by construction ([decision-log #46](../../decision-log.md)); the check is defense-in-depth so the invariant "**every`PanelLink.url`passes`isSafeLinkUrl`\*\*" is enforced in exactly one place. A non-integer/missing port (config/registry drift) yields no synthesized link.

The empty `envVar: ''` marks the link as synthesized (no configured env var produced it) — the same `envVar: ''` convention `degraded()` already uses ([src/panel/enrich.ts:144](../../../src/panel/enrich.ts)). No `PanelLink` type change (see [Open questions](#open-questions)).

### Wiring into `enrich.ts`

Two call sites, both replacing a direct `links` assignment with a `resolveServiceLinks` call:

- **`healthy()`** ([src/panel/enrich.ts:116-128](../../../src/panel/enrich.ts)): after building the `isSafeLinkUrl`-filtered `links` and reading `port = entry.ports[service.name]`, set the service's links to `resolveServiceLinks(links, port)`.
- **`degraded()`** ([src/panel/enrich.ts:142-149](../../../src/panel/enrich.ts)): a degraded worktree still knows each service's port (it builds services from raw `entry.ports`), so it can still offer a preview link. Replace `links: []` with `links: resolveServiceLinks([], port)`. This makes a config-missing/deleted-dir worktree's services previewable too — a deliberate behavior decision (called out as an AC), not just a healthy-path change.

`enrich.ts` only gains two short call-outs; the synthesis logic lives in the new module, keeping `enrich.ts` under the 250-line cap.

### Non-HTTP ports

A database/Redis/etc. service with no `http(s)` discovery URL gets a synthesized `http://localhost:<port>` that resolves to a dead link in the browser. This is **accepted over guessing** which ports are browser-openable (the synthesizer is deliberately dumb): the cost of a harmless dead link is lower than the cost of a heuristic that hides a real frontend. Documented, not fixed, in v1.

## A-2. Collapsible projects & worktrees, state persisted locally

A busy machine (many projects × many worktrees) needs to collapse noise to stay scannable. This is **purely a frontend change** under `panel/` — no backend, no snapshot change, no server change. `panel/**` is inert to every backend gate (ESLint/jscpd/knip/structure, [03-build-and-tooling.md](../management-panel/03-build-and-tooling.md)).

- `ProjectGroup` and `WorktreeCard` ([panel/src/components/](../../../panel/src/components)) gain a collapsible header: a `<button>` toggling expanded/collapsed with an `aria-expanded` chevron. Collapsed hides the children (worktrees / service rows) but keeps the header (label, and in Part B the at-a-glance badges) visible.
- **Persistence = `localStorage`.** The app is served same-origin from `http://127.0.0.1:<port>`, so `localStorage` is stable per-origin across Refresh clicks and process restarts on the same port. A small `panel/src/hooks/useCollapseState.ts` reads a `Set<string>` of collapsed IDs on mount and writes on toggle, under one key (`portweave-panel:collapsed`). Guard `JSON.parse` and `localStorage` access (private-mode / disabled storage) — on failure fall back to in-memory state so the panel never breaks over a storage error (the no-silent-throw spirit of [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md), applied in the frontend).
- **Stable IDs:** project by `gitCommonDir ?? label`, worktree by `worktreeRoot` — both stable across renders (`App.tsx` already keys `ProjectGroup` by `gitCommonDir ?? label`).
- **Per-port scoping accepted:** `localStorage` is keyed by origin (`127.0.0.1:<port>`), so collapse state does not carry across a different `--port`. Accepted for v1; not worth cross-port sharing.

## A-3. `projectName` grouping confirmed as-is

No code change. This records a confirmation: the panel groups by `gitCommonDir` and labels by `projectName` (explicit config value, else derived basename, else `'(no repo)'`) via [src/panel/labels.ts](../../../src/panel/labels.ts) / [decision-log #45](../../decision-log.md). Cross-repo name-merging stays **rejected** — it would cluster unrelated repos that happen to share a name. The existing label tests in `enrich.test.ts` ([01-server-and-api.md](../management-panel/01-server-and-api.md), cases 4a–4c) already pin this behavior; this spec adds no new test for A-3.

## Test layout

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md): real I/O against `os.tmpdir()`, `XDG_CONFIG_HOME`-isolated registry, injected `probe` stub for determinism.

### `src/panel/__tests__/service-links.test.ts` (new)

- **No explicit links → synthesized.** `resolveServiceLinks([], 31234)` → `[{ envVar: '', url: 'http://localhost:31234' }]`.
- **Explicit http(s) wins.** `resolveServiceLinks([{ envVar: 'API_URL', url: 'http://localhost:5173' }], 31234)` → unchanged (no synthesized link appended).
- **ws-only gets a synthesized http link.** `resolveServiceLinks([{ envVar: 'WS', url: 'ws://localhost:9 ' }], 31234)` → the `ws` link **plus** the synthesized `http://localhost:31234`.
- **Bad port → no synthesis.** A `NaN`/non-integer port yields no synthesized link.
- **Invariant.** Every returned `url` passes `isSafeLinkUrl`.

### `src/panel/__tests__/enrich.test.ts` (extend)

- **Healthy, no `discoveryEnv` → synthesized link.** Seed a service with no `discoveryEnv`; assert its `links` is exactly one synthesized `http://localhost:<allocated-port>` (replaces the old "→ empty links" expectation, [01-server-and-api.md case 6](../management-panel/01-server-and-api.md)).
- **Healthy, explicit http discovery URL → no synthesis.** Seed a service whose `discoveryEnv` resolves to `http://localhost:${svc}`; assert `links` contains the explicit URL and **no** extra synthesized one.
- **Healthy, only an unsafe/non-http discovery URL → synthesized http added.** Seed a service whose only `discoveryEnv` value is `postgres://…` (dropped by `isSafeLinkUrl`); assert `links` is the single synthesized `http://localhost:<port>`.
- **Degraded → synthesized link.** Seed a deleted-dir entry; assert each raw-port service has a synthesized `http://localhost:<port>` link (degraded services are now previewable) and `degraded: true` still holds.

## Acceptance criteria (this layer)

See the [index roll-up](./panel-triage.md#part-a--read-only-refinements-01). Load-bearing:

- [ ] `src/panel/service-links.ts` exports `resolveServiceLinks(explicit, port)` with the synthesize-unless-http behavior above; every returned `PanelLink.url` passes `isSafeLinkUrl`. Verified by `service-links.test.ts`.
- [ ] `enrich.ts` `healthy()` and `degraded()` both route links through `resolveServiceLinks`; a no-`discoveryEnv` service and a degraded service each expose a synthesized `http://localhost:<port>` link. Verified by extended `enrich.test.ts`.
- [ ] An explicit `http(s)` discovery URL is preserved and suppresses synthesis; `ws`/`wss` explicit links are preserved alongside a synthesized `http` link. Verified by `service-links.test.ts` + `enrich.test.ts`.
- [ ] Projects and worktrees collapse/expand in the `panel/` UI; collapse state persists across a Refresh via `localStorage`, with a safe fallback when storage is unavailable. Manual smoke (frontend unit tests out of scope per the [management-panel precedent](../management-panel/02-frontend.md)).
- [ ] `projectName` grouping is documented as confirmed-unchanged; no code or test change for A-3 (existing `enrich.test.ts` label cases stand).
- [ ] The read-only invariant ([server.test.ts test 16](../../../src/panel/__tests__/server.test.ts)) still passes — Part A adds no registry write.
- [ ] `npm run dev-workflow` is green; `service-links.ts` and the `enrich.ts` changes meet the 80% coverage thresholds ([vitest.shared.ts](../../../vitest.shared.ts)); `enrich.ts` stays under the 250-line cap.

## Open questions

**None blocking.** One deferred polish: add a `readonly synthesized?: boolean` to `PanelLink` so the frontend can render synthesized links with a subtler affordance (a muted "localhost" pill) than an explicitly-configured discovery URL. Out of scope for v1 — the empty `envVar` already discriminates, and the type change would have to be mirrored in `panel/src/types.ts`. Revisit only if the undifferentiated rendering proves confusing in practice.
