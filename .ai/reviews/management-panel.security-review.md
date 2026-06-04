---
title: Security Review — management-panel
feature: management-panel
diff_base: origin/main
reviewed_at: 2026-06-05
reviewer: security-review skill (Claude Opus 4.8)
verdict: pass
review_pass: 2 (post-remediation re-review)
---

# Security Review: management-panel (second pass)

**Verdict: pass**

This is the re-review after remediation of the single Required Action from the first pass
(a Medium DOM-XSS). Scope: the full change set on branch `claude/pedantic-cerf-b59ff0`
vs `origin/main`, including untracked files (`git status --short`). The feature adds a
loopback-only `node:http` server (`src/panel/`), a CLI subcommand (`src/cli/panel.ts`),
and a React/Vite browser UI (`panel/`). Reviewed as a **localhost-only, read-only,
on-demand dev dashboard** — no auth is expected for loopback, per the feature doc's scope.

**The first-pass Required Action (Finding 1, DOM-XSS) is RESOLVED.** No new issues were
introduced by the fix. All previously-verified fundamentals remain intact. No remaining
or new Required Actions.

---

# Resolution of first-pass Finding 1 — DOM-XSS via `discoveryEnv` URL in `href`

**Status: RESOLVED (verified at both the API and the component layer; defense in depth).**

The original finding: `ServiceRow` rendered `<a href={link.url}>` where `link.url` came from
a worktree's `discoveryEnv` template, validated only as `z.string()`. A config resolving to
`javascript:…` or `data:text/html,…` produced a clickable script-execution sink, and the
panel is machine-wide (it surfaces links from every repo on the box, including
untrusted-but-present ones), so the data crossed a real cross-repo trust boundary.

## What the remediation does

**Layer 1 — API filter (`src/panel/enrich.ts`).** A scheme allowlist is applied where links
are produced, before any URL enters `PanelLink[]`:

```ts
// enrich.ts:24-26
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])
const isSafeLinkUrl = (value: string): boolean =>
  URL.canParse(value) && SAFE_LINK_SCHEMES.has(new URL(value).protocol)
```

In `healthy()` (enrich.ts:126-128) the resolved links are `.filter((link) => isSafeLinkUrl(link.url))`.
An unsafe or unparseable URL is dropped from `links`; a service whose only discovery URL is
unsafe ends up with `links: []` and the UI shows the non-clickable port chip. Env injection is
untouched — the dropped URL is still produced by `buildEnvMap` and injected as an env var; only
the _clickable_ surface is filtered.

**Layer 2 — render-sink guard (`panel/src/components/ServiceRow.tsx`).** The component re-applies
the identical check (ServiceRow.tsx:9-11) and partitions links into `safe`/`unsafe`. Only `safe`
links emit an `<a href>` (lines 30-41); `unsafe` links render as inert `<span>` text (lines 48-56).
`target="_blank" rel="noreferrer"` is retained on the anchor. So even if a future change to the
API layer regressed, the component would not emit a script-bearing `href`.

## Why the fix is correct (verification performed)

- **Allowlist comparison is right.** `URL.protocol` returns the scheme _with_ its trailing colon
  (`'http:'`, `'javascript:'`). `SAFE_LINK_SCHEMES` entries are written with the colon, so the
  `.has(...)` comparison matches the real protocol value. `javascript:` and `data:` are not in
  the set → dropped at both layers. Confirmed against the regression test (enrich.test.ts:636-694):
  `http`/`https` survive; `javascript:alert(1)`, `javascript:alert(document.cookie)`, and
  `data:text/html,<script>…` are all absent from every service's `links`, and the unsafe-only
  `evil` service yields `links: []`.
- **Parse-failure path is safe.** The `&&` short-circuits: `new URL(value)` is only constructed
  after `URL.canParse(value)` returns `true`, so no exception can escape `isSafeLinkUrl`. An
  unparseable string returns `false` → dropped → port-chip / inert-text fallback. No new throw
  path, no crash of the snapshot or the render.
- **No `undefined` reaches the guard.** `buildEnvMap` (env/build.ts:26-34) writes
  `result[discoveryKey] = evaluateTemplate(...)` for every key in `service.discoveryEnv`, and
  `evaluateTemplate` (env/templates.ts:6-30) always returns a `string`. `healthy()` iterates the
  same `Object.keys(service.discoveryEnv)`, so `envMap[key]` is always a defined string. The
  guard never receives `undefined`.
- **Scheme-confusion / normalization bypasses ruled out.** The WHATWG `URL` parser normalizes the
  scheme (lowercases it, rejects embedded whitespace/control chars), so `JavaScript:`, a
  leading-space, or an embedded-tab variant either fails `canParse` or normalizes to a protocol
  still outside the allowlist. Protocol-relative `//host` fails `canParse` (no base). No bypass.
- **The clickable sink is the only one.** A full grep of `panel/src` for `href`, `src=`,
  `window.open`, `location.*`, `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`
  returns exactly one navigation sink — `ServiceRow.tsx:34` `href={link.url}` — and it is guarded.
  Nothing else in the UI can be steered to a `javascript:`/`data:` scheme.
- **Env injection / schema unchanged.** `discoveryEnvSchema = z.record(envVarSchema, z.string())`
  (schema.ts:19) is byte-identical to the first pass. The fix lives entirely in the panel's
  read/render path; the `run`-time injection contract is unaffected.

---

# Re-verification of previously-passing fundamentals (unchanged by the fix)

The remediation touched only `src/panel/enrich.ts`, `panel/src/components/ServiceRow.tsx`, and
`src/panel/__tests__/enrich.test.ts`. The following were re-confirmed still correct:

- **Loopback bind enforced.** `server.listen(options.port, LOOPBACK_HOST)` (server.ts:205) with
  `LOOPBACK_HOST = '127.0.0.1'` (server.ts:32). No wildcard / `0.0.0.0` path. Unchanged.
- **Path-traversal guard intact.** `resolveAssetPath` (server.ts:116-125):
  `decodeURIComponent` → `normalize` → strip leading slashes → `resolvePath` against
  `PANEL_ASSET_DIR`, then reject anything not equal to root or under `root + sep`. Encoded
  `..%2f` is decoded before the containment check, so it is covered. Unchanged.
- **Liveness probe host-pinned.** `liveness.ts:28` hardcodes `host: '127.0.0.1'`; only a numeric
  registry `port` varies. No host/protocol control → no SSRF. Unchanged.
- **No runtime-dependency leak.** React/Vite/`@types/*` remain `panel/` devDependencies; root
  `package.json` `dependencies` (`commander`, `zod`) unchanged; `files` publishes only `dist/`.
- **Read-only / GET-only.** Non-GET → 405 (server.ts:161-168); no registry or filesystem writes
  outside reading `dist/panel/` assets and the registry/config files (regression-guarded by
  enrich.test.ts:576-624, "leaves the on-disk registry byte-identical").
- **No unsafe React sinks; static error bodies.** No `dangerouslySetInnerHTML`/`eval`; error
  responses are static constants (server.ts:60-63), the only dynamic text being the user-supplied
  `--port` number (server.ts:186-189), not a path.

---

# Informational notes (no action required)

- **Info disclosure via `GET /api/allocations`.** The snapshot surfaces worktree/project paths,
  git-common-dirs, allocated ports, service names, and (now scheme-filtered) discovery URLs. This
  is the feature's purpose, loopback-only and read-only; values are env-var _names_ and port/URL
  values, not secret _values_ or PII. Acceptable for the stated scope. Re-flagging only so the
  boundary stays explicit: if the panel ever binds beyond loopback or gains auth-bearing data,
  revisit.
- **Unsafe-scheme links are still displayed as text** (ServiceRow.tsx:48-56). This is inert —
  rendered as a React text child (auto-escaped), never as an `href`. It is a deliberate UX choice
  (show the operator the configured value while refusing to make it clickable), not a sink.

---

# Required Actions

**None.** The single first-pass Required Action (Medium DOM-XSS) is resolved, verified at both
the `enrich.ts` API filter and the `ServiceRow.tsx` render guard, with a regression test in
`src/panel/__tests__/enrich.test.ts`. No remaining or new Required Actions. All other security
fundamentals (loopback bind, path-traversal guard, probe host-pinning, no runtime-dep leak,
read-only/GET-only, no unsafe React sinks) remain correct.
