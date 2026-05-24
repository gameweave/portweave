# Portweave v0 — Feature Implementation Plan

## Context

Portweave is at "scaffolding complete, implementation empty" — all dev infrastructure (lint, test, typecheck, dev-workflow, task management, husky hooks, CI) is in place, but [src/index.ts](../../src/index.ts) and [src/cli.ts](../../src/cli.ts) are stubs. The design is fully resolved in [.ai/DESIGN.md](../DESIGN.md) with 14 boardflip parity items in §7.2 and an explicit drop-in adoption test in §7.3.

This plan decomposes v0 into **10 cohesive features** ordered by their dependency graph, each shaped so a single `/create-feature` invocation can produce a spec + implementation. Each entry includes the §7.2 parity row(s), the boardflip reference files to mirror (never import — see CLAUDE.md), the new files to land under `src/`, a sketch of acceptance criteria, open questions, and a ready-to-paste invocation prompt.

### Decisions confirmed for this plan

- **Config layering (§6.1):** Both option (d) **named-services** and option (a) **zero-config anonymous** are in v0 scope. Feature #2 covers both modes.
- **JS library API (§6.4):** **Pulled forward** into v0 as Feature #9. Overrides decision-log row #6 — append a dated note when this is ratified.
- **License (§6.3):** Still TBD per decision-log row #12; not on the critical path.

### Cross-cutting conventions

All features must follow:

- [.claude/rules/coding-conventions.md](../../.claude/rules/coding-conventions.md) — kebab-case files, `.ts` import extensions, no semicolons
- [.claude/rules/error-handling.md](../../.claude/rules/error-handling.md) — `Result<T,E>` for fallible business logic, throw for invariant violations, `PW` error-code prefix
- [.claude/rules/testing.md](../../.claude/rules/testing.md) — Vitest 4, tests under `src/<area>/__tests__/`, real-I/O temp dirs preferred over mocks
- Run `npm run dev-workflow` before declaring any feature done

---

## Implementation Order

### 1. `result-types` — Result<T,E> primitives & PW error codes

**Parity row:** Foundation (no row). Required by all subsequent features.
**Depends on:** —
**Boardflip reference:** none — pattern documented in [.claude/rules/error-handling.md](../../.claude/rules/error-handling.md).

**Why first:** Every feature returning fallible logic depends on this. Tiny but unblocks everything.

**New files:**

- `src/result.ts` — `Result<T,E>`, `ok`, `err`, `andThen` (signatures already specified in error-handling.md)
- `src/errors.ts` — `PortweaveError` base class with `code: PW####` discriminant + initial code constants (registry-locked, registry-corrupt, config-missing, config-invalid, allocation-exhausted)
- `src/__tests__/result.test.ts`

**Acceptance criteria sketch:**

- [ ] `Result` type and helpers ship exactly as specified in error-handling.md
- [ ] `PortweaveError` survives `instanceof` checks across transpiled modules (`Object.setPrototypeOf` in constructor — see error-handling.md)
- [ ] `PW` error-code namespace seeded with at least the initial 5 codes used by Features 2–5
- [ ] All exports type-imported via `import type` where the runtime value isn't needed

**Open questions:** Number range allocation for PW codes (start at PW0001? group by component?).

**Invocation:**

```
/create-feature result-types — Add the Result<T,E> primitives in src/result.ts and the PortweaveError base + initial PW error-code namespace in src/errors.ts. Follow .claude/rules/error-handling.md exactly. Foundation for all subsequent v0 work.
```

---

### 2. `config-loader` — portweave.config.json schema + zero-config anonymous mode

**Parity rows:** §7.2 #5 (driven by config), #6 (urlTemplate per service), #10 (service groups).
**Depends on:** #1 (`Result`/errors)
**Boardflip reference:** [reference/boardflip/packages/shared/src/worktree-ports.ts](../../reference/boardflip/packages/shared/src/worktree-ports.ts) — the 8-service shape Portweave config must be able to express.

**Why this slot:** No allocator/env work can land without knowing what services exist. Zero-config mode (`--count N`) is the no-config-file fallback per §6.1 option (a).

**Scope:**

- Define the schema for `portweave.config.json` shown in DESIGN.md Appendix A (services with `envVar`, optional `preferred`, optional `group`, optional `discoveryEnv` URL templates).
- Validate with `zod` (already in dependencies per package.json).
- Loader returns `Result<NormalizedConfig, ConfigError>`.
- Anonymous mode: when no config file exists and caller passes `--count N`, synthesize an in-memory config with services named `port-1..port-N` and env vars `PORT_1..PORT_N`.

**New files:**

- `src/config/schema.ts` — zod schema + types
- `src/config/loader.ts` — `loadConfig(cwd, opts) -> Result<Config, ConfigError>`
- `src/config/anonymous.ts` — `synthesizeAnonymousConfig(count) -> Config`
- `src/config/__tests__/*.test.ts`

**Acceptance criteria sketch:**

- [ ] DESIGN.md Appendix A sample parses without errors
- [ ] Missing/malformed config returns a typed `ConfigError`, never throws
- [ ] Anonymous mode produces a valid `Config` interchangeable with file-loaded one downstream
- [ ] `discoveryEnv` URL templates retain their `${serviceName}` placeholders unresolved (resolution happens in Feature #6)
- [ ] Service `group` key surfaces in the normalized config so Feature #5 can allocate group members together

**Open questions:**

- Should `preferred` carry through to allocator as a hint (recorded for v1 hybrid mode) or be ignored at v0? DESIGN.md §5.1 says machine-wide pool gives "some" port — likely **ignore at v0** but normalize so the field survives the round-trip.
- File-name discovery — only `portweave.config.json`, or also `.portweaverc.json` / `package.json#portweave`? Recommend `portweave.config.json` only at v0.

**Invocation:**

```
/create-feature config-loader — Implement portweave.config.json parsing (zod) per DESIGN.md Appendix A, plus zero-config anonymous mode (PORT_1..PORT_N) per §6.1 option (a). Returns Result<Config, ConfigError>. Supports service groups and discoveryEnv URL templates (templates pass through unresolved). Depends on Feature 1 (result-types).
```

---

### 3. `worktree-context` — git detection, namespace derivation, manual overrides

**Parity rows:** §7.2 #3, #4, #8.
**Depends on:** #1
**Boardflip reference:**

- [reference/boardflip/scripts/src/utils/worktree-context-git.ts](../../reference/boardflip/scripts/src/utils/worktree-context-git.ts) — `git rev-parse --show-toplevel`, `--git-common-dir`, `worktree list --porcelain`
- [reference/boardflip/scripts/src/utils/worktree-context-namespace.ts](../../reference/boardflip/scripts/src/utils/worktree-context-namespace.ts) — `main` vs slug-hash, env override

**Scope:**

- Detect git worktree context: returns `{ currentRoot, gitCommonDir, mainRoot, worktreeRoots[] }` or `null` if not a git repo.
- Non-git fallback: use absolute `cwd` as the allocation key.
- Derive namespace: `"main"` when at the main worktree root, otherwise `<slugified-branch>-<8-char-hash>`. Honor `PORTWEAVE_NAMESPACE` and `PORTWEAVE_OFFSET` env overrides per DESIGN.md §7.2 row 8.

**New files:**

- `src/worktree/git.ts` — git-CLI shell out (uses `node:child_process`)
- `src/worktree/namespace.ts` — slug/hash derivation + env overrides
- `src/worktree/key.ts` — composes `AllocationKey = { gitCommonDir | null, worktreeRoot, namespace }`
- `src/worktree/__tests__/*.test.ts` — real-I/O against `os.tmpdir()` git-init temp repos

**Acceptance criteria sketch:**

- [ ] Detects main worktree, feature worktree, and non-git directory correctly against real temp repos
- [ ] Namespace derivation deterministic for the same branch name across runs
- [ ] `PORTWEAVE_NAMESPACE` and `PORTWEAVE_OFFSET` env vars override derived values
- [ ] `AllocationKey` is stable across restarts for the same worktree path (this is the stickiness contract per §5.4)

**Open questions:**

- Hash format: boardflip uses 8-char hash of absolute path. Match exactly, or upgrade to a longer/different scheme? Recommend **match boardflip** for migration debugging parity.

**Invocation:**

```
/create-feature worktree-context — Implement git worktree detection + namespace derivation matching boardflip's reference scripts/src/utils/worktree-context-git.ts and worktree-context-namespace.ts (PORTWEAVE_* env overrides instead of GAMEWEAVE_*). Falls back to cwd for non-git dirs. Produces the AllocationKey used by the registry. Depends on Feature 1.
```

---

### 4. `registry-storage` — registry.json I/O, directory-mutex locking, atomic writes, stale pruning

**Parity rows:** §7.2 #2, #7.
**Depends on:** #1
**Boardflip reference:** [reference/boardflip/scripts/src/utils/worktree-context-registry.ts](../../reference/boardflip/scripts/src/utils/worktree-context-registry.ts) — the canonical pattern (mkdir-based lock dir, 100 retries × 25ms, 30s stale-lock TTL, dedup by offset, prune-missing-worktrees on read).

**Scope:**

- File path: `~/.config/portweave/registry.json` (XDG, create parent dirs on first write).
- Registry record shape: `{ key: AllocationKey, ports: { [serviceName]: number }, lastUsedAt: ISO8601, namespace }`. No `offset` field — Portweave is machine-wide pool, not per-project offset.
- Locking: directory-mutex via `fs.mkdir` on `registry.lock/` with retry + exponential backoff + stale-lock cleanup (configurable but default to boardflip's 30s).
- Atomic writes: write to temp file then `fs.rename`.
- Pruning: on every read, drop entries whose `worktreeRoot` no longer exists; bump `lastUsedAt` on every claim/lookup.

**New files:**

- `src/registry/paths.ts` — XDG path resolution
- `src/registry/storage.ts` — `loadRegistry()`, `saveRegistry()`, `withLock(fn)`
- `src/registry/lock.ts` — directory-mutex implementation, retries, stale cleanup
- `src/registry/prune.ts` — stale-entry pruning logic
- `src/registry/__tests__/*.test.ts` — concurrent-write integration tests (real fs)

**Acceptance criteria sketch:**

- [ ] Concurrent writes from N processes serialize correctly (verified via real subprocess integration test)
- [ ] Stale lock (older than threshold) is recoverable without manual intervention
- [ ] Corrupted JSON returns a typed `Result` error (PW0003-class), never crashes the caller
- [ ] Pruning removes entries for deleted worktree paths but leaves entries for unrelated repos untouched
- [ ] `lastUsedAt` updates on lookup, not only on claim

**Open questions:**

- Lock timeout configurability — env var (`PORTWEAVE_LOCK_TIMEOUT_MS`)? CLI flag? Recommend env var only at v0.
- Stale-lock TTL — match boardflip's 30s, or shorter? Boardflip's value is battle-tested; **use 30s**.

**Invocation:**

```
/create-feature registry-storage — Implement ~/.config/portweave/registry.json I/O with directory-mutex locking (mirror boardflip's reference scripts/src/utils/worktree-context-registry.ts pattern: 100 retries × 25ms, 30s stale-lock TTL, atomic temp+rename writes, prune-on-read for deleted worktrees). No offset field — record schema is { key, ports, lastUsedAt, namespace }. Depends on Feature 1.
```

---

### 5. `port-allocator` — block selection from machine-wide pool, live conflict probe, service groups

**Parity rows:** §7.2 #1 (the key model change), #10 (groups), #13 (NEW: live conflict detection), #14 (NEW: cross-project collision protection).
**Depends on:** #2 (config), #3 (worktree-context), #4 (registry-storage)
**Boardflip reference:** [reference/boardflip/packages/shared/src/worktree-ports.ts](../../reference/boardflip/packages/shared/src/worktree-ports.ts) (shape only — Portweave does NOT use the `base + offset*100` formula).

**Why this slot:** Heart of the system. Everything before is plumbing; everything after is presentation.

**Scope:**

- **Allocate-or-reuse:** given an `AllocationKey` + a `Config`, return `Result<Allocation, AllocError>`. If the key already has an entry whose ports are still valid (live conflict probe passes), reuse it. Else allocate fresh.
- **Block selection:** from a configurable port pool range (suggested default: `30000–60000`), find the next contiguous block large enough for the config's service count. Skip ports listed in any other registry entry. Skip ports that fail the live probe.
- **Live conflict probe:** `net.createServer().listen(port, '127.0.0.1')`; if `EADDRINUSE`, port is in use by an external process — re-roll. (§7.2 row 13.)
- **Service groups:** ports within the same group must be contiguous and allocated as a unit (e.g. Kinesis 4567+4568).
- **Persistence:** wrap the allocation+write in `withLock` from Feature 4.

**New files:**

- `src/allocator/pool.ts` — block-search algorithm
- `src/allocator/probe.ts` — TCP-listen-probe utility
- `src/allocator/allocate.ts` — top-level `allocate(key, config) -> Result<Allocation, AllocError>` orchestrator
- `src/allocator/__tests__/*.test.ts` — including a concurrent-allocation stress test using real subprocesses

**Acceptance criteria sketch:**

- [ ] Two simultaneous worktrees of the same project never receive overlapping port blocks (concurrent integration test)
- [ ] Two unrelated projects on the same machine never collide on overlapping ports (§7.2 row 14)
- [ ] An externally-bound port is skipped, not assigned (§7.2 row 13)
- [ ] Service groups land contiguous within an allocation
- [ ] Same worktree on rerun gets the same ports (stickiness)
- [ ] Pool exhaustion returns a typed `Result` error (PW-class), not a crash

**Open questions:**

- Default pool range — `30000–60000`? Configurable per machine via `~/.config/portweave/portweave.toml` (or similar)? Recommend hardcoded default at v0, env override `PORTWEAVE_POOL_RANGE`.
- Block-search direction — ascending from low, or random within pool? Ascending is simpler and predictable; recommend **ascending**.

**Invocation:**

```
/create-feature port-allocator — Implement machine-wide-pool block allocation per DESIGN.md §5.1 + §7.2 rows 1/10/13/14. Live conflict probe via net.createServer listen-test. Service groups allocate contiguous. Returns Result<Allocation, AllocError>. Depends on Features 2, 3, 4.
```

---

### 6. `env-resolution` — env-var computation, URL template expansion, .portweave/current.env writer

**Parity rows:** §7.2 #5 (env injection), #6 (urlTemplate / discoveryEnv), #9 (.env seeding with user override priority).
**Depends on:** #2, #5
**Boardflip reference:**

- [reference/boardflip/scripts/src/utils/apply-worktree-env.ts](../../reference/boardflip/scripts/src/utils/apply-worktree-env.ts) — the env-injection + URL-construction logic
- [reference/boardflip/scripts/src/utils/e2e-port-env.ts](../../reference/boardflip/scripts/src/utils/e2e-port-env.ts) — the additional URL vars for E2E

**Scope:**

- Build the env-var map from an `Allocation + Config`: one entry per service (`config.services[name].envVar -> allocation.ports[name]`) plus all resolved `discoveryEnv` URL template entries.
- Template evaluation: `${serviceName}` → the allocated port; multiple placeholders per template supported.
- **.env seeding priority** (§7.2 row 9): existing `.env` values take precedence over computed values. Computed values seed unset keys.
- **Always-write .env (§5.2):** atomically write `.portweave/current.env` to the project root with the full computed env. Create `.portweave/` if missing.

**New files:**

- `src/env/build.ts` — `buildEnvMap(allocation, config) -> Record<string, string>`
- `src/env/templates.ts` — `${name}` URL template eval
- `src/env/dotenv-merge.ts` — read existing `.env`, layer computed values where keys are unset
- `src/env/writer.ts` — atomic write to `.portweave/current.env`
- `src/env/__tests__/*.test.ts`

**Acceptance criteria sketch:**

- [ ] DESIGN.md Appendix A config produces the env vars in DESIGN.md Appendix B output
- [ ] Multi-placeholder URL templates resolve correctly
- [ ] Existing `.env` keys win over computed values; missing keys get computed values
- [ ] `.portweave/current.env` is atomic (no partial writes visible) and human-readable dotenv format
- [ ] Parent `.portweave/` directory auto-created if missing

**Open questions:**

- `.portweave/.gitignore` — auto-create with `*` entry to keep the dir gitignored at the project level? Recommend **yes**, matches CLAUDE.md's "Runtime state is gitignored" guidance.

**Invocation:**

```
/create-feature env-resolution — Build the env-var map from Allocation+Config (named services + resolved discoveryEnv URL templates), layer over existing .env (existing values win), and atomically write .portweave/current.env. Mirror reference/boardflip/scripts/src/utils/apply-worktree-env.ts. Auto-create .portweave/.gitignore. Depends on Features 2, 5.
```

---

### 7. `run-command` — CLI skeleton + `portweave run -- <cmd>`

**Parity rows:** §7.2 #12 (wrapper CLI entry).
**Depends on:** #2, #3, #5, #6
**Boardflip reference:** [reference/boardflip/scripts/bin/dev.ts](../../reference/boardflip/scripts/bin/dev.ts) — the orchestrating wrapper.

**Scope:**

- Wire up `commander` (already in package.json deps) in [src/cli.ts](../../src/cli.ts).
- Implement `portweave run -- <command>`: resolve worktree context → load config → allocate → write `.env` → spawn child with merged env, inheriting stdio, propagating exit code/signals.
- Print the `[portweave]` allocation summary banner matching DESIGN.md Appendix B.
- Support global flags: `--config <path>`, `--count <n>` (anonymous mode), `--verbose`.

**New files:**

- `src/cli.ts` — commander root, command registration
- `src/cli/run.ts` — `run` subcommand handler
- `src/cli/spawn.ts` — child-process wrapper with signal forwarding (SIGINT/SIGTERM passthrough)
- `src/cli/banner.ts` — the `[portweave]` allocation banner formatter
- `src/cli/__tests__/*.test.ts` — integration tests that exec the built CLI against a temp config

**Acceptance criteria sketch:**

- [ ] `portweave run -- node -e 'console.log(process.env.API_PORT)'` prints the allocated port
- [ ] Child receives all computed env vars merged with the parent env
- [ ] SIGINT / SIGTERM from terminal propagates to the child cleanly
- [ ] Exit code of `portweave run` equals the child's exit code
- [ ] Banner output matches the shape in DESIGN.md Appendix B
- [ ] `--count N` anonymous mode works without a config file

**Open questions:**

- Stderr vs stdout for the `[portweave]` banner — banner goes to stderr so it doesn't pollute child stdout pipelines. Recommend **stderr**.

**Invocation:**

```
/create-feature run-command — Implement the portweave run -- <cmd> CLI per DESIGN.md §5.2 + Appendix B + §7.2 row 12. Wire commander, orchestrate worktree-context → config → allocator → env-writer → spawn child with merged env. Propagate signals + exit code. Banner to stderr. Supports --count anonymous mode. Depends on Features 2, 3, 5, 6.
```

---

### 8. `show-command` — `portweave show` introspection

**Parity rows:** Adjacent to §7.2 #12 (introspection per DESIGN.md §5.2).
**Depends on:** #2, #3, #4, #6 (env-resolution to format the same view)

**Scope:**

- `portweave show` resolves the current worktree, looks up the registry, and prints the same banner the `run` command would — without spawning anything.
- If no allocation exists yet, exits non-zero with a clear message ("no allocation; run `portweave run` first").
- `--json` flag emits machine-readable output (allocation key, ports, env-map, namespace).

**New files:**

- `src/cli/show.ts` — `show` subcommand handler
- `src/cli/__tests__/show.test.ts`

**Acceptance criteria sketch:**

- [ ] `portweave show` after a `portweave run` prints the same allocation, never mutates the registry
- [ ] `portweave show` before any allocation exits with a typed PW error and non-zero exit code
- [ ] `--json` output round-trips through `JSON.parse` cleanly and contains ports + namespace + worktree path

**Open questions:** None significant.

**Invocation:**

```
/create-feature show-command — Add portweave show subcommand per DESIGN.md §5.2: read-only registry lookup for the current worktree, prints the same banner as run, --json for machine-readable output. Non-zero exit if no allocation exists. Depends on Features 2, 3, 4, 6.
```

---

### 9. `library-runtime` — `import { ports } from 'portweave/runtime'` JS API

**Parity rows:** Resolves §6.4 (now pulled into v0). Enables Vite/Next config files that load before any wrapper child.
**Depends on:** #2, #3, #4, #5, #6
**Boardflip reference:** none directly — but conceptually mirrors how `apply-worktree-env.ts` could be called in-process.

**Scope:**

- Export a `portweave/runtime` subpath that synchronously returns the allocation for the current cwd. Allocates lazily if none exists (same code path as `run`) and writes `.env` as a side effect.
- API surface (minimal at v0): `ports(): { [serviceName]: number }`, `env(): Record<string, string>`, `allocation(): Allocation`.
- Update [package.json](../../package.json) `exports` field to expose `./runtime`.

**New files:**

- `src/runtime/index.ts` — the public library entry
- `src/runtime/__tests__/runtime.test.ts`
- Update `package.json` `exports`

**Acceptance criteria sketch:**

- [ ] `import { ports } from 'portweave/runtime'` resolves under both ESM and TypeScript projects (verified via a smoke test that builds a tiny consumer)
- [ ] Calling `ports()` from a Vite config file at config-eval time returns a valid block and writes `.portweave/current.env`
- [ ] Two simultaneous in-process callers (rare but possible) serialize through the same registry lock as the CLI

**Open questions:**

- Should the library be sync (simple) or async? Vite config can be async; recommend **async** (`await ports()`) — Node fs locking is async anyway.
- Append a dated note to [.ai/decision-log.md](../decision-log.md) overturning row #6.

**Invocation:**

```
/create-feature library-runtime — Add portweave/runtime subpath export with async ports()/env()/allocation() API. Reuses the same allocator + registry + env-writer path as the CLI so config-time consumers (Vite/Next config files) get the same allocation. Resolves DESIGN.md §6.4. Update package.json exports. Append dated decision-log note overturning row #6. Depends on Features 2, 3, 4, 5, 6.
```

---

### 10. `parity-verification` — boardflip drop-in adoption acceptance test

**Parity rows:** §7.3 acceptance test (gates v0).
**Depends on:** all prior features

**Scope:**

- Author a `portweave.config.json` declaring boardflip's 8 services (api, ws, vite, dynamodb, dynamodb-admin, kinesis, kinesis-tls, ses) with their env-var names and URL templates per [reference/boardflip/scripts/src/utils/apply-worktree-env.ts](../../reference/boardflip/scripts/src/utils/apply-worktree-env.ts).
- Integration test that simulates a boardflip-like environment: two simulated worktrees, runs `portweave run -- <noop>` in each, asserts that:
  - All 8 services receive ports
  - URL templates resolve identically to what `apply-worktree-env.ts` would emit
  - Ports across the two worktrees don't overlap
  - Reruns produce the same ports (stickiness)
- Document the migration steps in [README.md](../../README.md) following DESIGN.md §7.3.

**New files:**

- `__tests__/boardflip-parity.test.ts` (root-level cross-cutting integration test, per [.claude/rules/testing.md](../../.claude/rules/testing.md))
- `examples/boardflip.config.json` (sample config that boardflip would use)
- README.md migration section

**Acceptance criteria sketch:**

- [ ] All 14 boardflip parity items from DESIGN.md §7.2 verified explicitly in the test suite
- [ ] Two-worktree simultaneous-run test passes
- [ ] Migration doc lets a fresh reader follow §7.3 steps without external context
- [ ] `npm run dev-workflow` green

**Open questions:**

- Should this also run boardflip's real e2e suite in CI, or is the simulated test enough at v0? Recommend simulated only at v0 — real e2e adds a heavy CI dependency on boardflip's repo state.

**Invocation:**

```
/create-feature parity-verification — Add the boardflip drop-in acceptance test per DESIGN.md §7.3: portweave.config.json for boardflip's 8 services, integration test verifying all 14 §7.2 parity rows, README migration steps. Final v0 acceptance gate. Depends on all prior features.
```

---

## Dependency Graph (visual)

```
1 result-types
├── 2 config-loader
├── 3 worktree-context
└── 4 registry-storage
        └── 5 port-allocator  (needs 2, 3, 4)
                └── 6 env-resolution  (needs 2, 5)
                        ├── 7 run-command  (needs 2, 3, 5, 6)
                        ├── 8 show-command  (needs 2, 3, 4, 6)
                        └── 9 library-runtime  (needs 2, 3, 4, 5, 6)
                                └── 10 parity-verification (needs all)
```

Features 2, 3, 4 can be shipped in parallel after 1. Features 7, 8, 9 can be shipped in parallel after 6. Everything else is sequential.

---

## Verification (end-to-end check this plan is right)

After Feature #10, the following must all succeed from a fresh clone:

```bash
npm install
npm run dev-workflow          # All quality gates pass
npm test                      # All feature-level + parity tests pass

# Manual smoke against a temp dir:
cd "$(mktemp -d)" && git init
cp /path/to/portweave/examples/boardflip.config.json portweave.config.json
node /path/to/portweave/dist/cli.js show          # Non-zero exit (no allocation yet)
node /path/to/portweave/dist/cli.js run -- node -e 'console.log(process.env.API_PORT)'
cat .portweave/current.env                         # Shows allocation
node /path/to/portweave/dist/cli.js show           # Prints banner
```

Plus the boardflip-side validation per DESIGN.md §7.3 — a separate task once v0 ships.

---

## Notes for create-feature invocations

When invoking `/create-feature` for each item:

1. Run them sequentially in the dependency order above (1 → 10). Features 2–4, 7–9 batches can be parallelized if shipping with multiple agents simultaneously.
2. Each `/create-feature` invocation will draft a spec under `.ai/specs/<feature-name>.md`, await approval, then execute. The spec it produces should incorporate the **Acceptance criteria sketch** and **Open questions** from this plan as a starting point.
3. After each feature ships, append a row to the decision log if any non-trivial design call was made during execution.
4. Feature #9 explicitly needs a decision-log row appended (overturning row #6).
5. Don't skip `npm run dev-workflow` between features — quality gates compound.
