# panel — build integration & tooling isolation

**Parent:** [management-panel.md](./management-panel.md) (index)
**Siblings:** [01-server-and-api.md](./01-server-and-api.md), [02-frontend.md](./02-frontend.md)

This sub-spec owns the wiring that joins the isolated frontend ([02](./02-frontend.md)) to the package build, and the guarantees that the frontend's presence does not perturb the backend quality gates. Every claim below was checked against the actual config files; the relevant `path:line` is cited so the implementer can confirm nothing has drifted.

## Build wiring

Today the root build is backend-only ([package.json:46](../../../package.json)):

```json
"build": "tsc --project tsconfig.build.json && chmod +x dist/cli.js"
```

Extend it so the frontend builds into `dist/panel/` after the backend compiles:

```json
"build": "tsc --project tsconfig.build.json && chmod +x dist/cli.js && npm --prefix panel ci && npm --prefix panel run build"
```

Order: backend `tsc` first (cheap, and `dist/` must exist), then install the frontend's isolated deps (`npm --prefix panel ci`), then `vite build` (which emits to `../dist/panel` per [02's vite.config.ts](./02-frontend.md)). Notes:

- `npm --prefix panel ci` is included so a clean checkout (and CI) materializes `panel/node_modules` before the frontend build. On a warm local tree it is a fast no-op-ish step; if iteration speed matters, a `build:backend` / `build:panel` split is a reasonable later refinement (flag, not a blocker).
- `prepublishOnly` already runs `npm run build` ([package.json:76](../../../package.json)), so `npm publish` will include a freshly-built `dist/panel/`.
- `pretest` runs `npm run build` ([package.json:52](../../../package.json)). To avoid forcing a full frontend install on every `npm test`, the panel server's tests do **not** depend on `dist/panel/` existing — `GET /api/allocations` works without a built UI and `GET /` returns a graceful `503` when the UI is absent ([01 static-fallback](./01-server-and-api.md)). So even if `pretest` is later narrowed to a backend-only build, tests stay green. (If `pretest`'s `npm run build` becomes too slow with the frontend step, splitting `build` and pointing `pretest` at the backend half is the mitigation.)

## Publish: no `files` change

`files: ["dist/", "README.md", "LICENSE"]` ([package.json:40-44](../../../package.json)) already publishes everything under `dist/`, so `dist/panel/` ships automatically once `build` emits it. **No edit to `files` is required.** Verify with `npm pack --dry-run` after a build: the tarball listing must include `dist/panel/index.html` and the hashed asset files.

## No new runtime dependency (the core guarantee)

Root `dependencies` today is exactly `commander` + `zod` ([package.json:78-81](../../../package.json)). This feature adds **nothing** there:

- The server uses `node:http` and `node:net` (built-ins) — same posture as the existing `node:net` probe ([src/allocator/probe.ts:1](../../../src/allocator/probe.ts)).
- React / Vite / `@vitejs/plugin-react` / `@types/react*` live in **`panel/package.json`** as that app's devDependencies — a separate dependency closure that npm never installs for consumers of the published `portweave` package.

Verification: after the feature lands, `npm run deadcode:check` (knip) must be green and the root `package.json` `dependencies` block must be unchanged in the diff. An explicit guard test is optional; the diff + knip cover it.

## Tooling isolation — verified against each config

The frontend folder must be inert to the backend's `dev-workflow` gates. Below is the status of each gate, with the actual scoping cited. **Two gates need an explicit `panel/**`ignore added; the rest are already scoped to`src`/`scripts`/`config` and need no change.\*\*

| Gate                                   | Current scope (cited)                                                                                                                                                                                                                                                                                    | Sees `panel/`?                                                                                                        | Action                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint` (ESLint)                        | `ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/reports/**', '**/coverage/**', '**/*.js.map', '.claude/**']` ([eslint.config.ts:22-30](../../../eslint.config.ts)); typed rules apply to `**/*.ts` via a shared `projectService` ([eslint.config.ts:56-64](../../../eslint.config.ts)) | **Yes** — `panel/**/*.ts(x)` would be matched and type-checked against the backend project service, which would error | **Add `'panel/**'`to ESLint`ignores`.\*\*                                                                                                                                                                        |
| `dupcheck` (jscpd)                     | `format: ['typescript','tsx','css']`; `ignore` includes `examples/**` and `.claude/**` but **not** `panel/**` ([.jscpd.json](../../../.jscpd.json))                                                                                                                                                      | **Yes** — jscpd scans `tsx`/`css`, so frontend files would be duplication-checked                                     | **Add `'panel/**'`to`.jscpd.json` `ignore`.\*\*                                                                                                                                                                  |
| `typecheck` (root `tsc`)               | `tsconfig.build.json` includes only `src/**/*.ts` ([tsconfig.build.json:10-11](../../../tsconfig.build.json)); root `tsconfig.json` includes `src/**/*.ts` + `__tests__/**/*.ts` ([tsconfig.json:9](../../../tsconfig.json)); `tsconfig.config.json` covers scripts/config                               | No                                                                                                                    | None — `panel/` is outside every root `include`.                                                                                                                                                                 |
| `deadcode:check` (knip)                | `project: ['src/**/*.ts','scripts/**/*.ts','config/**/*.ts']`, `entry: ['src/cli.ts','src/index.ts','scripts/bin/*.ts']` ([knip.json:3-4](../../../knip.json))                                                                                                                                           | No                                                                                                                    | None — `panel/` is outside `project`.                                                                                                                                                                            |
| `structure:check`                      | `ROOTS = ['src', 'scripts']` ([scripts/bin/structure-check.ts:8](../../../scripts/bin/structure-check.ts))                                                                                                                                                                                               | No                                                                                                                    | None.                                                                                                                                                                                                            |
| `test` (vitest)                        | `include: ['src/**/*.test.ts','__tests__/**/*.test.ts']` ([vitest.config.ts:10](../../../vitest.config.ts)); coverage `include: ['src/**/*.{js,mjs,ts}']` ([vitest.shared.ts:39](../../../vitest.shared.ts))                                                                                             | No                                                                                                                    | None — frontend has no `*.test.ts` under `src`; its future tests live under `panel/` with its own runner.                                                                                                        |
| `complexity:check` / `constants:check` | ESLint-complexity-only and constants-check run over the same backend source set                                                                                                                                                                                                                          | No (once ESLint ignores `panel/**`)                                                                                   | Covered by the ESLint `ignores` change.                                                                                                                                                                          |
| `format:check` (Prettier)              | runs via `scripts/bin/format.ts`                                                                                                                                                                                                                                                                         | Possibly                                                                                                              | Confirm Prettier's target set; if it globs the repo, add `panel/**` to `.prettierignore` (or let the frontend own its formatting). Low-risk; flag for the implementer to verify against `scripts/bin/format.ts`. |
| `similarity:check`                     | similarity-ts over backend source (skipped without Rust)                                                                                                                                                                                                                                                 | No (TS-source scoped)                                                                                                 | None expected; confirm its root matches `src`/`scripts`.                                                                                                                                                         |

### gitignore

`node_modules/` ([.gitignore:1](../../../.gitignore)) has no leading slash, so it already matches `panel/node_modules/` at any depth — **functionally covered.** Adding an explicit `panel/node_modules/` line is optional clarity, not a requirement. `dist/` is already ignored ([.gitignore:2](../../../.gitignore)), so `dist/panel/` is too.

### Net required edits

1. `eslint.config.ts` — add `'panel/**'` to the top-level `ignores` array.
2. `.jscpd.json` — add `'panel/**'` to `ignore`.
3. `package.json` — extend the `build` script to also build `panel/`.
4. (Verify, possibly edit) Prettier ignore — confirm `scripts/bin/format.ts`'s target set; add `panel/**` to a `.prettierignore` if it would otherwise format frontend files.

Everything else (knip, structure-check, both root tsconfigs, vitest, constants-check) is already scoped away from `panel/` and needs no change — this is the payoff of the folder-level isolation in [02](./02-frontend.md).

## CI

`.github/workflows/ci.yml` runs `npm run dev-workflow` ([.claude/rules/ai-dev-workflow.md](../../../.claude/rules/ai-dev-workflow.md)). Because `dev-workflow` does not itself run `npm run build` for the frontend (the backend tests don't need it, [01](./01-server-and-api.md)), CI does not need a separate frontend-build step for the gates to pass. If a later goal is to publish-validate the UI build in CI, add an explicit `npm run build` step **after** the install steps so `ci-workflow:check`'s install-before-check ordering stays satisfied ([.claude/rules/ai-dev-workflow.md](../../../.claude/rules/ai-dev-workflow.md)). Not required for the POC gates.

## Acceptance criteria (this layer)

See the [index roll-up](./management-panel.md#build--tooling-03). The load-bearing ones:

- [ ] Root `npm run build` produces both the backend (`dist/cli.js` + compiled `src`) and `dist/panel/` (frontend). Verified by running it and asserting both outputs.
- [ ] Root `package.json` `dependencies` remains exactly `commander` + `zod`; React/Vite are only in `panel/package.json`. Verified by `package.json` diff + `deadcode:check`.
- [ ] `dist/panel/` ships in `npm pack --dry-run` with no change to `files`. Verified by the pack listing.
- [ ] `panel/**` added to ESLint `ignores` and `.jscpd.json` `ignore`; `npm run lint` and `npm run dupcheck` stay green with `panel/` present.
- [ ] knip, structure-check, root tsc, and vitest are unaffected (already `src`/`scripts`/`config`-scoped). Verified by `dev-workflow` staying green.
- [ ] `panel/node_modules/` is untracked by git. Verified by `git status`.
- [ ] `npm run dev-workflow` green end to end.
