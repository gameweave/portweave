# Boardflip drop-in acceptance gate

**Status:** approved
**Owner:** TBD
**Feature doc:** [.ai/features/parity-verification/parity-verification.md](../../features/parity-verification/parity-verification.md)
**Decision-log rows:** [#7](../../decision-log.md) (v0 scope cap is boardflip parity), [#14](../../decision-log.md) (drop-in adoption by boardflip is the v0 verification criterion), every prior feature row by transitive reference

## Problem

v0 ships only if Portweave can replace boardflip's hand-rolled worktree-port system without users noticing functional regressions ([decision-log row #14](../../decision-log.md), [DESIGN.md §7.3](../../DESIGN.md)). Every prior v0 feature spec verifies its own slice in isolation — config parses, registry locks, allocator avoids collisions, env resolution produces the right map, the CLI orchestrates, the library facade returns the same allocation. None of those, individually, prove that the **integrated system** behaves like boardflip's stack does today.

This feature is the single gating test that proves it. Without it, "v0 reaches parity" is a claim; with it, "v0 reaches parity" is a green test. The test:

1. Authors a `portweave.config.json` mirroring boardflip's eight services with their env-var names, group labels, and `discoveryEnv` URL templates.
2. Simulates two real git worktrees of the same repo and invokes `portweave run -- <noop>` in each.
3. Asserts that every one of the 14 boardflip parity items in [DESIGN.md §7.2](../../DESIGN.md) holds against the integrated v0 system.
4. Documents the migration steps a boardflip maintainer follows to retire their hand-rolled system, written so a fresh reader can execute the procedure without external context.

This is also where the env-var contract Portweave produces gets cross-checked against the exact shape [reference/boardflip/scripts/src/utils/apply-worktree-env.ts](../../../reference/boardflip/scripts/src/utils/apply-worktree-env.ts) emits today — including the constructed discovery URLs (`WEBSOCKET_ENDPOINT`, `DYNAMODB_ENDPOINT`, `KINESIS_ENDPOINT`, `SES_ENDPOINT`) that boardflip's runtime depends on.

## Approach

One sample config under `examples/`, one cross-cutting integration test under `__tests__/`, and a migration section appended to `README.md`. No new code under `src/` — this feature is an integration acceptance test, not an implementation.

### `examples/boardflip.config.json` — the parity config

Authored to exactly match boardflip's env-var surface. The eight services with their grouping and discovery URLs:

```jsonc
{
  "$schema": "https://portweave.dev/schema/v1.json",
  "services": {
    "api": {
      "envVar": "API_PORT",
      "discoveryEnv": {
        "VITE_API_PORT": "${api}",
        "VITE_API_URL": "http://localhost:${api}",
        "E2E_API_ORIGIN": "http://localhost:${api}",
      },
    },
    "ws": {
      "envVar": "WS_PORT",
      "discoveryEnv": {
        "VITE_WS_PORT": "${ws}",
        "VITE_WS_URL": "ws://localhost:${ws}",
        "WEBSOCKET_ENDPOINT": "http://localhost:${ws}",
      },
    },
    "vite": { "envVar": "VITE_PORT" },
    "dynamodb": {
      "group": "dynamodb",
      "envVar": "DYNAMODB_PORT",
      "discoveryEnv": { "DYNAMODB_ENDPOINT": "http://localhost:${dynamodb}" },
    },
    "dynamodb-admin": { "group": "dynamodb", "envVar": "DYNAMODB_ADMIN_PORT" },
    "kinesis": {
      "group": "kinesis",
      "envVar": "KINESIS_PORT",
      "discoveryEnv": { "KINESIS_ENDPOINT": "http://localhost:${kinesis}" },
    },
    "kinesis-tls": { "group": "kinesis", "envVar": "KINESIS_TLS_PORT" },
    "ses": {
      "envVar": "SES_LOCAL_PORT",
      "discoveryEnv": { "SES_ENDPOINT": "http://localhost:${ses}" },
    },
  },
}
```

This config is the exemplar shipped with Portweave and the primary input to the integration test. The discovery-URL shapes mirror [reference/boardflip/scripts/src/utils/apply-worktree-env.ts:85–110](../../../reference/boardflip/scripts/src/utils/apply-worktree-env.ts) — `VITE_API_PORT` and `VITE_WS_PORT` are deliberate aliases of `API_PORT` / `WS_PORT` (boardflip's `seedIfMissing` pattern), and the four `*_ENDPOINT` URLs use `http://localhost:${...}` even for kinesis-TLS-adjacent services because boardflip itself does. Faithful parity, not improved parity.

### `__tests__/boardflip-parity.test.ts` — the integration gate

Root-level cross-cutting test per [.claude/rules/testing.md](../../../.claude/rules/testing.md). Vitest 4. Uses real I/O against `os.tmpdir()` and real `git init` / `git worktree add` invocations. Mocked anything is not acceptable for this test — the whole point is to verify the integrated system, not its components.

Test fixture setup (a `beforeAll` shared across the assertion blocks):

1. Create a temp directory `tmpdir`, `git init` it, set up an initial commit so worktrees can be added.
2. Create `tmpdir/main/` as the main worktree, write `examples/boardflip.config.json` content into `tmpdir/main/portweave.config.json`.
3. Create `tmpdir/feature-x/` as a real git worktree via `git worktree add tmpdir/feature-x feature-x`. Copy the same `portweave.config.json` into it. (Or symlink — either works; copy is more explicit about the parity story.)
4. Set `XDG_CONFIG_HOME=tmpdir/xdg` so the registry lives in a test-scoped location and the test never touches the user's real registry.
5. Build the CLI once (or invoke `node /path/to/dist/cli.js` against the just-built artifact — see open question on build coupling).

The test then asserts each of the 14 §7.2 parity rows. Each assertion block in the test source begins with a comment of the form `// Row N: <description>` so a reviewer can cross-reference against the [§7.2 table](../../DESIGN.md) without guesswork:

- **Row 1 (per-worktree block from machine-wide pool).** Run `portweave run -- node -e 'console.log(process.env.API_PORT)'` from `tmpdir/main/`. Parse the stdout. Assert the returned `API_PORT` is in the configured pool range. Run again from `tmpdir/feature-x/`. Assert both runs produced a complete block of 8 ports and the two blocks do not overlap.
- **Row 2 (file-locked registry + retry + stale-lock).** Already exercised by registry-storage's concurrent test, but this row is re-verified here by running the two-worktree allocation step **simultaneously** via `Promise.all([spawn(main), spawn(feature-x)])`. Both subprocesses must exit 0 and produce disjoint blocks. (Distinct from registry-storage's standalone concurrent test, this one exercises the full CLI → allocator → env-writer path under contention.)
- **Row 3 (git worktree detection + cwd fallback).** Implicit in steps 1–3 above — if worktree-context misdetected, the namespaces would collide. The test additionally asserts that running `portweave run` from `tmpdir/main/` produces `namespace: "main"` (via the JSON output of `portweave show`) and from `tmpdir/feature-x/` produces a `feature-x-<8charhash>` namespace.
- **Row 4 (namespace derivation main vs feature-slug-hash).** Subsumed by the Row 3 assertions plus an explicit hash-format check (`/^feature-x-[a-f0-9]{8}$/`).
- **Row 5 (env-var injection for named services).** The child invocation prints all 8 `envVar` values (`API_PORT`, `WS_PORT`, `VITE_PORT`, `DYNAMODB_PORT`, `DYNAMODB_ADMIN_PORT`, `KINESIS_PORT`, `KINESIS_TLS_PORT`, `SES_LOCAL_PORT`). Each value must be a parseable positive integer in the pool range.
- **Row 6 (discovery URL construction).** The child invocation prints all constructed URL env vars: `VITE_API_URL`, `E2E_API_ORIGIN`, `VITE_WS_URL`, `WEBSOCKET_ENDPOINT`, `DYNAMODB_ENDPOINT`, `KINESIS_ENDPOINT`, `SES_ENDPOINT`. The values must equal `${shape}://localhost:${port}` where `${port}` is the corresponding service's allocated port — verified by computing the expected string from the parsed ports and comparing.
- **Row 7 (stale-entry pruning + last-used timestamps).** After both worktrees have run, manually `rm -rf` `tmpdir/feature-x/` (simulating a deleted worktree). Run `portweave show --json` from `tmpdir/main/` (which triggers a registry read with prune-on-read). Inspect the registry file at `tmpdir/xdg/portweave/registry.json`: the entry for `feature-x` must be gone; the entry for `main` must remain with a freshly bumped `lastUsedAt`.
- **Row 8 (manual override via `PORTWEAVE_NAMESPACE` / `PORTWEAVE_OFFSET`).** Invoke `portweave run` from `tmpdir/main/` with `PORTWEAVE_NAMESPACE=custom-ns`. Assert the namespace in the resulting `portweave show --json` output is `custom-ns` (overriding the derived `main`). Separate invocation with `PORTWEAVE_OFFSET=42` — verify the `offsetOverride` field round-trips into the registry entry (allocator does not use it at v0 per the [port-allocator spec](../port-allocator/port-allocator.md), but it must survive storage).
- **Row 9 (.env seeding with user-override priority).** Write a `tmpdir/main/.env` containing `API_PORT=4000\nOTHER_THING=foo\n` _before_ invoking `portweave run`. Run the command. Read the resulting `tmpdir/main/.portweave/current.env`: `API_PORT=4000` (override won), `OTHER_THING` is _not_ present (env-resolution only forwards Portweave-known keys per the [env-resolution spec](../env-resolution/env-resolution.md)), and `VITE_API_URL=http://localhost:${allocated-api-port}` (template still uses the allocated port, not the override — also per the env-resolution spec). Verify the child process saw `API_PORT=4000`.
- **Row 10 (service groups, paired ports).** Inspect the allocation's `ports` map from `portweave show --json`. Assert `ports.kinesis` and `ports.kinesis-tls` are adjacent integers (difference of 1), and `ports.dynamodb` and `ports.dynamodb-admin` are adjacent integers. Group adjacency must hold across both worktrees independently.
- **Row 11 (E2E helper / configure Playwright env).** The library runtime is the v0 surface for this. Author a tiny consumer at `tmpdir/main/use-runtime.mjs` that does `import { ports } from '/<repo>/dist/runtime/index.js'; console.log(JSON.stringify(await ports()));`. Run it as a child. Assert the printed JSON matches the allocation from `portweave show --json` (same ports). This exercises the §6.4 promise that config-time callers (Vite/Next/Vitest) see the same ports as the wrapper-spawned children.
- **Row 12 (wrapper CLI entry point).** Implicit in every assertion above — every `portweave run` invocation _is_ the wrapper entry point. Additionally assert that the child's exit code equals the noop's exit code (run `portweave run -- node -e 'process.exit(7)'` and verify the wrapper exits 7).
- **Row 13 (live conflict detection).** Before running `portweave run` in `tmpdir/feature-x/`, manually bind a `net.Server` to one of the ports that `portweave show --json` for `tmpdir/main/` allocated to a service. Now run `portweave run` from `tmpdir/feature-x/`. Assert: (a) the run succeeds, (b) the feature-x allocation does not include the bound port, (c) the feature-x allocation does not overlap main's allocation.
- **Row 14 (cross-project collision protection).** Within the same test process, create a _second_ temp dir `tmpdir2` with its own `git init` and a different `portweave.config.json` (one service, custom env-var name). Run `portweave run` in `tmpdir2/`. Assert the resulting allocation does not overlap any of the ports allocated in `tmpdir/main/` or `tmpdir/feature-x/`.

After all 14 row assertions pass, a final block verifies the **stickiness contract** across the integrated system: re-run `portweave run` in `tmpdir/main/` and assert the `ports` map is byte-identical to the prior run (DESIGN.md §5.4 across the full stack).

### `README.md` migration section

Append a `## Migrating from a hand-rolled worktree-port system (boardflip)` section to [README.md](../../../README.md) covering the six steps from [DESIGN.md §7.3](../../DESIGN.md):

1. Delete `scripts/src/utils/worktree-context-*.ts` and related helpers in the boardflip consumer.
2. Delete `packages/shared/src/worktree-ports.ts`.
3. Add `portweave.config.json` declaring the eight services with their env-var names and URL templates (cross-link to `examples/boardflip.config.json` as a concrete reference).
4. Change `scripts/bin/dev.ts` to invoke `portweave run` before its existing PM2 startup.
5. Update the PM2 ecosystem config to read the process-name suffix from `PORTWEAVE_NAMESPACE` instead of internal helpers.
6. Acceptance: all boardflip e2e tests still pass; worktree behavior identical from a user's POV.

Section is written so a fresh reader who has never seen Portweave can execute the procedure against a real boardflip checkout without external context. Cite the parity test in this repo as evidence that the integrated system already passes the contract a boardflip user is relying on.

### Test layout placement and naming

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md):

> Cross-cutting integration tests that don't belong to one module live under `__tests__/` (root).

This feature's test lives at `__tests__/boardflip-parity.test.ts`. The supporting fixture (the build-the-CLI helper, the noop child source, the use-runtime.mjs consumer) lives at `__tests__/fixtures/boardflip-parity/` — kept under the test directory so `structure:check` doesn't need to be relaxed.

### CLI binary path resolution

The test invokes `node <path>/dist/cli.js` against the built artifact. The build artifact path is computed from `import.meta.url` so the test works from any worktree checkout. If the build hasn't run, the test fails with a clear "run `npm run build` first" message rather than misleading allocation errors — the helper that locates `dist/cli.js` exits the test with a directive message if the path doesn't exist. Future work: wire the test into a `pretest` hook that runs `npm run build` automatically; deferred for v0 to keep the change minimal.

### Decision-log impact

One row to append on `Status: shipped`:

- v0 acceptance: all 14 boardflip parity rows verified by `__tests__/boardflip-parity.test.ts`. Boardflip migration documented in README. The acceptance test is the gate for shipping v0; merging without it green is not permitted.

## Acceptance criteria

- [ ] `examples/boardflip.config.json` exists and declares all eight services (`api`, `ws`, `vite`, `dynamodb`, `dynamodb-admin`, `kinesis`, `kinesis-tls`, `ses`) with their env-var names, group labels (`dynamodb`, `kinesis`), and `discoveryEnv` URL templates matching boardflip's [apply-worktree-env.ts](../../../reference/boardflip/scripts/src/utils/apply-worktree-env.ts) shape.
- [ ] The example config validates cleanly through the config loader — `loadConfig(<path-to-examples-dir>)` returns `ok(Config)` with all eight services normalized.
- [ ] `__tests__/boardflip-parity.test.ts` exists and runs a two-worktree simulation against a real temp git repo, with `XDG_CONFIG_HOME` scoped to a test-only registry path.
- [ ] All 14 §7.2 parity rows are individually asserted by the test, each with a `// Row N: <description>` comment in the test source so a reviewer can cross-reference §7.2 by line.
- [ ] Row 1 + Row 14 assertion: two worktrees of the same repo plus a third unrelated project allocation produce three disjoint blocks; no port appears in more than one allocation.
- [ ] Row 5 + Row 6 assertion: every env-var key listed in the boardflip parity config (8 `envVar`s plus all `discoveryEnv` keys) is set on the spawned child process; each port-valued key holds an integer in the pool range; each URL-valued key has shape `${scheme}://localhost:${port}` where the port matches the corresponding service's allocation.
- [ ] Row 9 assertion: when `tmpdir/main/.env` pre-declares `API_PORT=4000`, the resulting `.portweave/current.env` carries `API_PORT=4000` (override won) and the discovery URL `VITE_API_URL=http://localhost:${allocated-port}` (template uses allocated port, not override).
- [ ] Row 10 assertion: `ports.kinesis` and `ports.kinesis-tls` differ by exactly 1; `ports.dynamodb` and `ports.dynamodb-admin` differ by exactly 1; group adjacency holds independently in both worktrees.
- [ ] Row 11 assertion: a child invocation of `node use-runtime.mjs` (which imports `portweave/runtime` and calls `await ports()`) produces a JSON output whose ports match the allocation from `portweave show --json` byte-for-byte.
- [ ] Row 13 assertion: with an externally-bound port simulated via `net.createServer().listen(port)`, a fresh allocation in a second worktree does not include the bound port.
- [ ] **End-to-end stickiness**: re-running `portweave run` in the same simulated worktree produces a byte-identical `ports` map to the prior run, verified by capturing the allocation before and comparing after.
- [ ] **End-to-end concurrency**: the two worktrees' allocation runs are kicked off via `Promise.all` (simultaneous via spawned subprocesses); both succeed, both produce disjoint blocks.
- [ ] `README.md` contains a `## Migrating from a hand-rolled worktree-port system (boardflip)` section covering the six steps from DESIGN.md §7.3, cross-linking to `examples/boardflip.config.json`, written so a fresh reader can execute the procedure without external context.
- [ ] The test fails with a clear "run `npm run build` first" message (not a misleading allocation error) if `dist/cli.js` does not exist when the test starts.
- [ ] Coverage thresholds in `vitest.shared.ts` are still met across the whole repo with this test in place; the integration test contributes to coverage of the upstream features it exercises.
- [ ] `npm run dev-workflow` is green: `format:check`, `lint`, `typecheck`, `dupcheck`, `deadcode:check`, `structure:check`, `complexity:check`, `constants:check`, `ci-workflow:check`, `test`, `upgrade:check`.
- [ ] One decision-log row is appended on `Status: shipped` capturing that all 14 boardflip parity rows are verified by `__tests__/boardflip-parity.test.ts` and that the test is the v0 ship gate.

## Open questions

- **Live boardflip e2e in CI.** Per the feature doc's open question and the roadmap's recommendation, this spec stays with the **simulated** test only at v0. The recommendation: ratify this as a v0 decision and defer the live-boardflip-e2e-in-CI variant to a post-v0 follow-up if real adoption surfaces gaps the simulation misses. The cost of running boardflip's full e2e against a Portweave binary in CI is high (boardflip repo checkout, its own dependency install, its e2e harness setup) and the value at v0 is incremental — the simulated test covers every contractual surface. Flag in case approval wants to flip this; if so, the spec adds a CI workflow file under `.github/workflows/boardflip-e2e.yml` that's documented as nightly rather than per-PR to avoid blocking development.
- **Pretest build hook.** Currently the test fails with a clear message if `dist/cli.js` does not exist. A `"pretest": "npm run build"` script entry would make the test self-contained but doubles test-run cost during iterative development (every `npm test` invocation rebuilds). Recommendation: keep the fail-with-clear-message behavior at v0; revisit if the friction surfaces in real use. The CI workflow already runs `npm run build` before `npm test` so the pretest hook isn't load-bearing for the green-build gate.
- **Anonymous-mode parity assertion.** The current spec exercises only the named-services config path. Should the test also verify that `portweave run --count 8 -- <noop>` produces a valid 8-port allocation under anonymous mode? Recommendation: add one small assertion for this, since anonymous mode is part of the v0 scope per the [config-loader spec](../config-loader/config-loader.md). This will be added before promoting `Status: approved`.
