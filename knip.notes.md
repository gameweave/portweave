# knip.json — ignore-entry rationale

Knip's strict JSON schema rejects unknown top-level keys, so this sidecar
documents why each entry in [knip.json](./knip.json) exists.

## `ignore` entries

| Path                                      | Why ignored                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/src/tasks/**`                    | Session-based task-management subsystem (vendored dev tooling). No production callers in `src/`; surface lives entirely in `scripts/`. Knip's static analysis sees no entry path.                                                                                                                                          |
| `scripts/src/utils/ci-workflow-parser.ts` | Consumed via `execFile` by [`scripts/bin/ci-workflow-check.ts`](scripts/bin/ci-workflow-check.ts). Knip's static analysis can't trace dynamic-imports across process boundaries.                                                                                                                                           |
| `src/allocator/cross-project.ts`          | Source-side companion file for [`src/allocator/__tests__/cross-project.test.ts`](src/allocator/__tests__/cross-project.test.ts). `structure:check` requires every `*.test.ts` to have a sibling source file. Contents are intentionally trivial — the real test logic lives in the test file. See the file header comment. |
| `src/allocator/order.ts`                  | Same pattern as `cross-project.ts` — sibling source for [`src/allocator/__tests__/order.test.ts`](src/allocator/__tests__/order.test.ts).                                                                                                                                                                                  |
| `src/runtime/error-passthrough.ts`        | Thin re-export of error types so [`src/runtime/__tests__/error-passthrough.test.ts`](src/runtime/__tests__/error-passthrough.test.ts) has a sibling source file. See the file header.                                                                                                                                      |
| `src/runtime/exports-smoke.ts`            | Helpers for the exports smoke test ([`src/runtime/__tests__/exports-smoke.test.ts`](src/runtime/__tests__/exports-smoke.test.ts)). The test is gated on `RUN_SMOKE_TESTS=1`, so the exports look unused to knip in default runs.                                                                                           |

## `ignoreDependencies` entries

| Dep               | Why ignored                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `constants-check` | Invoked via npm script (`scripts/bin/constants-check.ts`), not imported. |
| `jscpd`           | Invoked via npm script (`scripts/bin/dupcheck.ts`), not imported.        |
| `prettier`        | Invoked via npm script (`scripts/bin/format.ts`), not imported.          |
