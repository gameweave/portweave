# Portweave

> Zero-thought, conflict-free local-dev port allocation across projects and git worktrees.

Portweave hands every project, git worktree, and parallel agent run its own block of ports from a single machine-wide pool. You declare your services once; Portweave allocates a unique, sticky port block per worktree, injects them as environment variables, and writes a `.portweave/current.env` file for tools that don't inherit a parent process's environment. There is no daemon, no network call, and no telemetry — all coordination happens through one lock-protected JSON file in your config directory.

It is built for developers who run several projects on one machine, who use git worktrees for parallel feature work, and for AI coding agents that spin up dev servers and verification loops in parallel worktrees without colliding on ports.

## Contents

- [Implementation prompt](#implementation-prompt)
- [Install](#install)
- [Quick start](#quick-start)
- [How Portweave works](#how-portweave-works)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [Recipes](#recipes)
- [Migrating from an existing port setup](#migrating-from-an-existing-port-setup)
- [Environment variable overrides](#environment-variable-overrides)
- [Runtime library API](#runtime-library-api)
- [Errors and recovery](#errors-and-recovery)
- [How allocations are stored](#how-allocations-are-stored)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License and resources](#license-and-resources)

## Implementation prompt

**Want your AI agent to set this up?** Paste the prompt below into Claude Code, Cursor, or any coding agent working in your project. It is self-contained — the agent doesn't need the rest of this README.

```text
Integrate the `portweave` npm package so this project's local dev servers
get conflict-free, sticky ports per git worktree.

1. Install it as a dev dependency, matching this repo's package manager:
   `npm install --save-dev portweave` (or `pnpm add -D portweave`,
   or `yarn add -D portweave`).
2. Inspect the project for every process that binds a local port — dev
   server, API, websocket, database, mail/queue emulators, etc. — and note
   the environment variable each one reads its port from.
3. Create `portweave.config.json` at the repo root. Add one entry per
   service under `services`, keyed by a kebab-case name:
   `{ "envVar": "<PORT_ENV_VAR>" }`. For derived values like base URLs or
   connection strings, add a `discoveryEnv` map whose templates use
   `${serviceName}` to interpolate the allocated port. Give services that
   must receive adjacent ports the same `group`.
4. In `package.json`, wrap each dev/test command that needs ports with
   `portweave run -- <command>` (e.g. `"dev": "portweave run -- vite"`).
5. For config files evaluated at startup (`vite.config`, `next.config`,
   `vitest.config`), do not read `process.env` — import the allocation from
   the async runtime API instead:
       import { ports } from 'portweave/runtime'
       const p = await ports()
       if (!p.ok) throw new Error(`${p.error.message} (${p.error.code})`)
       // then use p.value.<serviceName>
6. Replace any hardcoded port literals with reads of the injected env vars.
7. Add `.portweave/` to `.gitignore`.
8. Verify: run the wrapped dev script and confirm the `[portweave]` banner
   lists every service and the app binds the allocated ports.

CLI note: global flags go BEFORE the subcommand —
`portweave --count 3 run -- npm run dev`, never after `run`.
```

## Install

```bash
npm install --save-dev portweave
# or
pnpm add -D portweave
# or
yarn add -D portweave
```

Portweave is a dev dependency. Invoke it with `npx portweave …` or from a `package.json` script — there is no global install and no `portweave init`. Requires Node.js 24 or newer.

**Supported platforms:** macOS and Linux, both exercised by CI on every change. Windows is not supported at this time.

Add the per-project output directory to your `.gitignore`:

```gitignore
.portweave/
```

## Quick start

**1. Create `portweave.config.json` in your project root.** Declare each service that needs a port and the environment variable it should be exposed as:

```json
{
  "$schema": "https://raw.githubusercontent.com/gameweave/portweave/main/schema/v1.json",
  "services": {
    "api": {
      "envVar": "API_PORT",
      "discoveryEnv": { "API_URL": "http://localhost:${api}" }
    },
    "web": { "envVar": "WEB_PORT" }
  }
}
```

**2. Wrap your dev command** in `package.json` so it runs under `portweave run`:

```json
{
  "scripts": {
    "dev": "portweave run -- vite"
  }
}
```

**3. Run it.** Portweave allocates a port block, prints what it did, injects the env vars into `vite`, and writes `.portweave/current.env`:

```text
$ npm run dev
[portweave] worktree: my-app (namespace: main)
[portweave] allocated:
  api   → 30002     (API_PORT)
  web   → 30003     (WEB_PORT)
[portweave] wrote .portweave/current.env
[portweave] launching: vite
```

Inside `vite` (and any process it spawns), `process.env.API_PORT` is `30002`, `process.env.WEB_PORT` is `30003`, and `process.env.API_URL` is `http://localhost:30002`.

Run the same command again from the same worktree and you get the **same** ports back (the banner reads `reusing existing allocation:`). Create a second git worktree of the project and run it there — you get a **different** block automatically, with no configuration change. Start an unrelated project on the same machine — also no collision, because the registry is machine-wide.

## How Portweave works

- **One config file per project.** `portweave.config.json` lists the services that need ports and the environment-variable names they map to. That is the only project-level configuration Portweave needs.

- **A single machine-wide pool.** All allocations are recorded in one registry at `~/.config/portweave/registry.json` (or `$XDG_CONFIG_HOME/portweave/registry.json`). Because every project on the machine draws from the same pool, two projects that both default to port 5173 never collide. The default pool is ports `30000`–`60000`.

- **Sticky, per-worktree allocations.** Each allocation is keyed on the worktree's git common directory, its derived namespace, and its path on disk. The same worktree gets the same ports across restarts and across terminals; a different worktree of the same repo gets a different block. The main worktree's namespace is `main`; other worktrees derive a namespace like `feature-auth-7a2b91c3` (a slug from the directory name plus a short hash of its path). Directories that are not git repositories fall back to using the directory itself as the key.

- **Live conflict detection.** Before claiming a _new_ block, Portweave opens a TCP listener on each candidate port. If something external (a system Postgres, another tool) already holds a port, Portweave re-rolls and picks a free block instead. This probe runs only when allocating a fresh block — re-running in a worktree that already has an allocation always returns the same block, even when that worktree's own servers are currently bound to those ports, so a config file that resolves its port after sibling services are already up stays in sync with the injected env.

- **Two outputs from one code path.** `portweave run` injects the allocated ports as environment variables into the child process **and** writes the same values to `.portweave/current.env`. Use the injected env directly for anything launched by `portweave run`; use the file for tools that evaluate before the child inherits an environment — Docker Compose, Vite/Next config files, IDE run configurations.

## Configuration

Portweave looks for `portweave.config.json`, starting in the working directory and walking up toward the filesystem root (so it is found from subdirectories too). Here is a configuration that exercises every supported field:

```json
{
  "$schema": "https://raw.githubusercontent.com/gameweave/portweave/main/schema/v1.json",
  "services": {
    "api": {
      "envVar": "API_PORT",
      "discoveryEnv": {
        "API_URL": "http://localhost:${api}",
        "VITE_API_URL": "http://localhost:${api}"
      }
    },
    "web": { "envVar": "WEB_PORT" },
    "ws": {
      "envVar": "WS_PORT",
      "discoveryEnv": { "VITE_WS_URL": "ws://localhost:${ws}" }
    },
    "db": {
      "group": "data",
      "envVar": "DB_PORT",
      "discoveryEnv": { "DATABASE_URL": "postgres://localhost:${db}/app" }
    },
    "db-admin": { "group": "data", "envVar": "DB_ADMIN_PORT" }
  }
}
```

Field reference:

| Field                          | Required     | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                      | optional     | A schema URL string. Ignored at runtime; useful for editor autocompletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `services`                     | **required** | An object with at least one entry. Each key is a service name in kebab-case (`^[a-z][a-z0-9-]*$`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `services.<name>.envVar`       | **required** | The environment-variable name the allocated port is exposed as. Must match `^[A-Z][A-Z0-9_]*$`. Must be unique across all services.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `services.<name>.group`        | optional     | A group label. Services sharing a group are allocated as a contiguous block, so they move together (handy when a tool expects two adjacent ports).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `services.<name>.discoveryEnv` | optional     | A map of additional environment variables to derived values. Each value is a template; `${serviceName}` is replaced with that service's allocated port, `${pw:<field>}` with worktree metadata, and the reserved `${namespace}` token with the worktree namespace (all three covered below). Keys must be valid env-var names, unique across the whole config, and must not start with the reserved `PORTWEAVE_` prefix. A `${name}` that matches neither a declared service, a known metadata field, nor the reserved `${namespace}` token is a configuration error. |

A copyable starting point lives at [`examples/web-app.config.json`](examples/web-app.config.json).

Notes that affect how you write templates:

- `${serviceName}` always resolves to the **allocated** port for that service, even if you override the service's own `envVar` through a project `.env` file. Derived URLs stay internally consistent.
- `${pw:<field>}` resolves Portweave metadata for the current worktree. Available fields: `namespace` (`main` or `<slug>-<hash>`), `worktreeRoot` (absolute path), and `gitCommonDir` (the shared `.git` directory, or empty string outside a git repo). Compose them freely, e.g. `"OTEL_SERVICE_NAME": "gw-${pw:namespace}"`.
- `${namespace}` is a **reserved** shorthand for `${pw:namespace}` — the worktree namespace. It always resolves to the namespace, even if a service is literally named `namespace` (that service's port is still reachable through its own `envVar`, just not through `${namespace}`). It is the ergonomic primitive for isolating **non-port** resources per worktree — e.g. `"DDB_TABLE_PREFIX": "local-${namespace}"`, `"REGISTRY_BUCKET_PREFIX": "gw-${namespace}"`, or a PM2 process name. See [Isolating non-port resources per worktree](#isolating-non-port-resources-per-worktree).
- The configuration file is strict: unknown top-level keys and unknown service fields are rejected with a `PW0102` error that names the offending path.

### Injected metadata: `PORTWEAVE_NAMESPACE`

Every `portweave run` injects `PORTWEAVE_NAMESPACE` into the child process (and writes it to `.portweave/current.env`) with no configuration required. Its value is the worktree namespace Portweave allocated under — `main` for the primary worktree, `<slug>-<hash>` for others.

This is the primitive for keeping worktrees from colliding in shared, single-instance daemons. The canonical case is PM2: name each app `<service>-${process.env.PORTWEAVE_NAMESPACE}` (e.g. in `ecosystem.config.cjs`) so two worktrees running the same stack register distinct process names in the one PM2 daemon. Portweave allocates the ports and hands you the namespace; it never manages processes itself.

`PORTWEAVE_NAMESPACE` is authoritative: it always reports the namespace Portweave used, so a value set in your project `.env` or parent environment does not change what the child observes (an explicit value is still honored as an _override of which namespace gets derived_ — set it before invoking `portweave run`).

### Isolating non-port resources per worktree

Ports are not the only thing that collides when you run the same stack in two worktrees at once. PM2 process names, database table prefixes, S3/registry key prefixes, and cache directories all need to be worktree-unique too — and the namespace is exactly that primitive. Portweave isolates ports automatically; the namespace lets you isolate everything else with the same key, so two worktrees never clobber each other's processes, tables, or buckets.

There are three ways to reach the namespace, matched to where you need it:

| You're in…                                   | Use                                        | Example                                         |
| -------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| a `portweave run` child (any language)       | the injected `PORTWEAVE_NAMESPACE` env var | `pm2 start api --name api-$PORTWEAVE_NAMESPACE` |
| `portweave.config.json` (declarative)        | the reserved `${namespace}` template token | `"DDB_TABLE_PREFIX": "local-${namespace}"`      |
| a JS/TS config or script (before allocation) | `namespace()` from `portweave/runtime`     | `` `gw-${(await namespace()).value}` ``         |

All three return the same value for a given worktree (`main`, or `<slug>-<hash>`), so you can mix them freely across a stack. A declarative `discoveryEnv` example:

```json
{
  "services": {
    "api": {
      "envVar": "API_PORT",
      "discoveryEnv": {
        "DDB_TABLE_PREFIX": "local-${namespace}",
        "REGISTRY_BUCKET_PREFIX": "gw-${namespace}",
        "CACHE_DIR": ".cache/${namespace}"
      }
    }
  }
}
```

In the main worktree these resolve to `local-main` / `gw-main` / `.cache/main`; in a feature worktree to `local-feature-auth-7a2b91c3` and so on. This is what lets Portweave stand in for a homegrown per-worktree allocator that exposed a `{ namespace }` of its own: the port side is automatic, and the namespace covers the rest.

## CLI reference

```text
portweave [global options] <command> [-- command to run]
```

Global options are parsed **before** the subcommand. The following all live on the root command:

| Global option     | Description                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `--config <path>` | Use a specific config file instead of discovering `portweave.config.json`.                              |
| `--count <n>`     | Anonymous mode: allocate `n` ports with no config file (see below). Mutually exclusive with `--config`. |
| `--verbose`       | Print extra diagnostic lines (config path, registry path, allocation key).                              |
| `-V`, `--version` | Print the version.                                                                                      |
| `-h`, `--help`    | Print help.                                                                                             |

> Because these are global options, they go **before** the subcommand: `portweave --count 3 run -- npm run dev` works; `portweave run --count 3 …` does not (the flag is ignored).

### `portweave run -- <command>`

Allocates (or reuses) the port block for the current worktree, writes `.portweave/current.env`, injects the env vars, and runs `<command>` as a child process. Everything after `--` is the command and its arguments.

```bash
portweave run -- vite
portweave run -- npm run dev
portweave --config ./ports.dev.json run -- node server.js
portweave --count 3 run -- npm run dev        # anonymous mode, no config file
```

- The allocation banner is printed to **stderr**, so it never pollutes a pipeline reading the child's stdout.
- Signals (`SIGINT`, `SIGTERM`) are forwarded to the child.
- **Exit code:** the child's exit code on success; `1` for a Portweave error (invalid flags, missing config, locked registry, etc.); `127` if the child command could not be spawned.

**Anonymous mode** (`--count n`) needs no config file. It synthesizes `n` services named `port-1`…`port-n`, exposed as `PORT_1`…`PORT_n`. `n` must be an integer in `[1, 100]`. Useful for throwaway scripts or agents that just need "some free ports":

```bash
$ portweave --count 2 run -- node -e "console.log(process.env.PORT_1, process.env.PORT_2)"
[portweave] worktree: my-app (namespace: main)
[portweave] allocated:
  port-1  → 30000     (PORT_1)
  port-2  → 30001     (PORT_2)
[portweave] wrote .portweave/current.env
[portweave] launching: node -e console.log(process.env.PORT_1, process.env.PORT_2)
30000 30001
```

### `portweave show`

Prints the current worktree's existing allocation without changing anything. Output goes to stdout.

```bash
$ portweave show
[portweave] worktree: my-app (namespace: main)
[portweave] reusing existing allocation:
  api       → 30002     (API_PORT)
  web       → 30003     (WEB_PORT)
  db        → 30004     (DB_PORT)
  db-admin  → 30005     (DB_ADMIN_PORT)
```

Add `--json` for machine-readable output — ideal for scripts and agents. Keys are sorted:

```bash
$ portweave show --json
{
  "env": {
    "API_PORT": "30002",
    "API_URL": "http://localhost:30002",
    "DATABASE_URL": "postgres://localhost:30004/app",
    "DB_ADMIN_PORT": "30005",
    "DB_PORT": "30004",
    "WEB_PORT": "30003"
  },
  "namespace": "main",
  "ports": { "api": 30002, "db": 30004, "db-admin": 30005, "web": 30003 },
  "worktreeRoot": "/path/to/my-app"
}
```

If the worktree has no allocation yet, `show` exits `1` and tells you to run `portweave run` first.

## Recipes

### Use with an npm/pnpm/yarn dev script

Wrap the script's command with `portweave run --`. Nothing else changes; your dev tool reads the injected env vars.

```jsonc
// package.json
{
  "scripts": {
    "dev": "portweave run -- vite",
    "dev:server": "portweave run -- node server.js",
    "test:e2e": "portweave run -- playwright test",
  },
}
```

Read the ports inside your code from the env vars you declared (`process.env.API_PORT`, etc.). This works because `portweave run` injects the allocation into the child process before your tool starts.

### Use across git worktrees in parallel

This is the headline case and needs **no per-worktree configuration**. The same `portweave.config.json` is committed once; each worktree gets its own sticky block because the allocation key includes the worktree path.

```bash
# Terminal 1 — main worktree
~/code/my-app          $ npm run dev
[portweave] worktree: my-app (namespace: main)
[portweave] allocated:
  api   → 30002     (API_PORT)
  web   → 30003     (WEB_PORT)

# Terminal 2 — a feature worktree of the same repo, at the same time
~/code/my-app-feature  $ npm run dev
[portweave] worktree: my-app-feature (namespace: feature-auth-7a2b91c3)
[portweave] allocated:
  api   → 30004     (API_PORT)
  web   → 30005     (WEB_PORT)
```

Both dev servers run simultaneously with no collision. Re-running in either worktree reuses that worktree's block. When you delete a worktree, its registry entry is pruned automatically on the next Portweave run.

### Use with Docker Compose

Compose does not inherit a parent process's environment, but it can read an env file. Point it at the file Portweave writes on every `portweave run`:

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    env_file: .portweave/current.env
    ports:
      - '${DB_PORT}:5432'
```

Run Compose under Portweave so the file exists and `${DB_PORT}` is substituted in the Compose file itself:

```bash
portweave run -- docker compose up
```

`.portweave/current.env` is a plain `KEY=value` file (see [`portweave show --json`](#portweave-show) for the same data programmatically), regenerated on every run.

### Use in a Vite, Next.js, or Vitest config file

Config files are evaluated by the bundler at startup, before any child process inherits an environment — so reading `process.env.API_PORT` there is unreliable. Import the allocation directly from the runtime API instead. It runs the same allocator the CLI uses, so it returns the same sticky ports:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { ports } from 'portweave/runtime'

export default defineConfig(async () => {
  const result = await ports()
  if (!result.ok) {
    throw new Error(`portweave: ${result.error.message} (${result.error.code})`)
  }
  return {
    server: { port: result.value.web },
    define: { __API_PORT__: result.value.api },
  }
})
```

See [Runtime library API](#runtime-library-api) for the full surface.

### Use in CI

In CI each job runs in isolation, so collisions are unlikely — but to pin a deterministic block (for example, to reference the same ports across steps), set `PORTWEAVE_OFFSET`:

```yaml
# .github/workflows/ci.yml
jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      PORTWEAVE_OFFSET: '0'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run test:e2e # script wraps the command with `portweave run --`
```

### Read the allocated ports from a sibling script

Anything launched by `portweave run` already has the env vars. For a separate process, either read the file or call the runtime API.

```bash
# Shell: source the file Portweave wrote
set -a; . .portweave/current.env; set +a
echo "API is on $API_PORT"

# Or get JSON without launching anything
portweave show --json | jq -r '.ports.api'
```

```ts
// Node: call the runtime API directly
import { ports } from 'portweave/runtime'

const result = await ports()
if (result.ok) console.log(result.value.api)
```

## Migrating from an existing port setup

Portweave replaces ad-hoc port coordination. The shape of the migration depends on what you have today.

### From hardcoded ports in `.env` / `.env.local`

If you currently keep ports in a committed or copied `.env` file:

```diff
# .env  (before)
- API_PORT=3001
- WEB_PORT=5173
- DATABASE_URL=postgres://localhost:5432/app
```

Move those names into `portweave.config.json` and let Portweave compute them:

```json
{
  "services": {
    "api": { "envVar": "API_PORT" },
    "web": { "envVar": "WEB_PORT" },
    "db": {
      "envVar": "DB_PORT",
      "discoveryEnv": { "DATABASE_URL": "postgres://localhost:${db}/app" }
    }
  }
}
```

Then wrap your dev/test scripts with `portweave run --`. A project `.env` still works for _non-port_ settings; Portweave only overrides the keys it computes, and leaves everything else for your existing dotenv loader. If you set one of Portweave's keys in `.env`, that value wins over the computed one — useful for pinning a single port locally. The override applies uniformly: through `portweave run` into the child process, through the `ports()` and `env()` runtime APIs, and into `.portweave/current.env`. If your prior setup only honored `.env` along some paths (e.g. only e2e tests sourced it), expect every path to honor it under Portweave.

### From a hand-rolled `base + offset` convention

Some teams compute ports with a formula like `BASE_PORT + (worktreeOffset * 100)` and a per-repo registry. Portweave subsumes this: it gives you the same "same worktree → same ports, all services move together" behavior, plus cross-project collision protection, without the offset bookkeeping or a per-repo cap. Replace the formula with a config file that lists the services, delete the helper that computed offsets, and wrap your startup command with `portweave run --`. If a downstream tool (e.g. a process manager) needs a stable name per worktree, read `PORTWEAVE_NAMESPACE`, which Portweave sets in the child environment.

### From auto-increment-on-collision (e.g. Vite's default)

Vite picks the next free port when its preferred one is taken, which means a server's port can change between runs and differs from whatever your tests or proxy expect. When you want a **stable** port per worktree instead, declare the service in `portweave.config.json` and start Vite under `portweave run -- vite`, reading `server.port` from the runtime API (see the [Vite recipe](#use-in-a-vite-nextjs-or-vitest-config-file)). The port is now deterministic for that worktree across restarts.

## Environment variable overrides

These variables tune allocation behavior. Set them in your shell, a `.env` consumed before invoking Portweave, or a CI job's `env:` block.

| Variable                    | Effect                                                                                                                                      | Default                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `PORTWEAVE_OFFSET`          | Forces a specific allocation offset. Must be a non-negative integer. Useful for pinning a deterministic block in CI or on a shared machine. | derived from the worktree path                          |
| `PORTWEAVE_NAMESPACE`       | Overrides the namespace string (the value exposed as `PORTWEAVE_NAMESPACE` and used in the banner). The value is slugified.                 | `main` for the main worktree; `<slug>-<hash>` otherwise |
| `PORTWEAVE_POOL_RANGE`      | Overrides the candidate port pool. Format `<start>-<end>`; both integers, `start >= 1024`, `end > start`.                                   | `30000-60000`                                           |
| `PORTWEAVE_LOCK_TIMEOUT_MS` | How long to wait when acquiring the registry lock before giving up with `PW0301`.                                                           | ~2500 ms (100 retries × 25 ms)                          |
| `XDG_CONFIG_HOME`           | Base directory for the registry. Portweave uses `$XDG_CONFIG_HOME/portweave/`.                                                              | `~/.config`                                             |

Malformed values for `PORTWEAVE_POOL_RANGE` and `PORTWEAVE_LOCK_TIMEOUT_MS` fall back to the default; the pool-range case also prints a one-line warning to stderr so a typo doesn't silently change allocations. A non-integer `PORTWEAVE_OFFSET` is a hard error (`PW0202`).

## Runtime library API

For config files and scripts that need the allocation before a child process exists, import from `portweave/runtime`. Every export is async and returns a `Result` you must narrow. `ports()`, `env()`, and `allocation()` run the same allocate-and-resolve pipeline as the CLI; `namespace()` is a lightweight shortcut that resolves only the worktree namespace, without allocating ports:

```ts
import { ports, env, allocation, namespace } from 'portweave/runtime'

// ports() → Result<Record<string, number>, PortweaveError>
// Per-service numeric ports, with `.env` overrides applied. Use this when you
// need to bind a server or pass a port number to a child process.
const p = await ports()
if (p.ok) console.log(p.value.api) // 30002, or your .env override if set

// env() → Result<Record<string, string>, PortweaveError>
// The full computed env map, including discoveryEnv URLs. `.env` overrides
// are applied to envVar keys; discovery templates still resolve against the
// allocated port (see decision-log #26).
const e = await env()
if (e.ok) console.log(e.value.DATABASE_URL)

// allocation() → Result<Allocation, PortweaveError>
// The raw allocation: namespace, ports, and worktree key. Does NOT apply
// `.env` overrides — use for introspection / debugging, not for binding.
const a = await allocation()
if (a.ok) console.log(a.value.namespace)

// namespace() → Result<string, PortweaveError>
// The per-worktree namespace string ("main" or "<slug>-<hash>"), identical to
// allocation().value.namespace and the injected PORTWEAVE_NAMESPACE — but
// resolved WITHOUT allocating or probing ports, and without needing a config
// file. Use it to name non-port resources per worktree (PM2 process names, DB
// table prefixes, cache dirs). cwd-stable: same value from any subdirectory.
const n = await namespace()
if (n.ok) console.log(`gw-${n.value}`) // e.g. "gw-feature-auth-7a2b91c3"
```

A `Result` is `{ ok: true, value } | { ok: false, error }`; on the error arm, `error` is a `PortweaveError` with a `.code` (one of the `PW####` codes) and a `.message`. Each function accepts an optional options object:

| Option       | Type     | Meaning                                                                                               |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `cwd`        | `string` | Directory used for worktree-key resolution and config discovery. Defaults to `process.cwd()`.         |
| `configPath` | `string` | Use a specific config file; skips upward-directory discovery.                                         |
| `count`      | `number` | Anonymous-mode fallback: if no config file is found, synthesize `count` services (`port-1`…`port-N`). |

`namespace()` only reads `cwd` — it does not load a config, so `configPath` and `count` have no effect on it (and it succeeds even when no `portweave.config.json` exists).

Calling `ports()`, `env()`, or `allocation()` allocates exactly as the CLI does — it acquires the registry lock, reuses the sticky block for the worktree, and writes `.portweave/current.env` as a side effect. `namespace()` does none of that: it resolves the worktree key only, so it acquires no lock, probes no ports, and writes no file.

## Errors and recovery

Errors carry a stable `PW####` code, printed as `[portweave] error: <message> (<code>)`. The codes an end user is likely to encounter:

| Code     | Meaning                                                                       | Recovery                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PW0101` | No `portweave.config.json` found.                                             | Add a config file, or use anonymous mode: `portweave --count N run -- …`.                                                                                                    |
| `PW0102` | Config failed validation.                                                     | The message names the offending path (e.g. `services.api.envVar: …`). Fix that field.                                                                                        |
| `PW0202` | `PORTWEAVE_OFFSET` is not a non-negative integer.                             | Correct or unset the variable.                                                                                                                                               |
| `PW0301` | Could not acquire the registry lock in time.                                  | Usually transient — Portweave retries. If it persists, a process crashed holding the lock; remove `~/.config/portweave/registry.lock`, or raise `PORTWEAVE_LOCK_TIMEOUT_MS`. |
| `PW0302` | The registry JSON is corrupt.                                                 | Inspect `~/.config/portweave/registry.json`; fix or delete it (it will be recreated).                                                                                        |
| `PW0401` | No free port block large enough in the pool.                                  | Widen the pool with `PORTWEAVE_POOL_RANGE`, or remove stale entries from the registry.                                                                                       |
| `PW0502` | A `.env` line could not be parsed.                                            | The message names the line number; fix or quote the value.                                                                                                                   |
| `PW0503` | A `.env` override for a service envVar is not a valid port in [1, 65535].     | Fix the value in `.env` (only emitted by the runtime `ports()` API; `env()` returns the literal string).                                                                     |
| `PW0601` | Invalid CLI flags (e.g. `--config` with `--count`, or no command after `--`). | Correct the invocation.                                                                                                                                                      |
| `PW0602` | The command after `--` could not be spawned (exit `127`).                     | Check the command exists and is on `PATH`.                                                                                                                                   |
| `PW0701` | The runtime API found no config and was given no `count`.                     | Pass `{ count }`, `{ configPath }`, or add a `portweave.config.json`.                                                                                                        |

Add `--verbose` to any `portweave run` invocation to print the resolved config path, registry path, and allocation key alongside the error.

## How allocations are stored

- **The registry** lives at `~/.config/portweave/registry.json` (or `$XDG_CONFIG_HOME/portweave/registry.json`). It is plain, human-readable JSON — safe to inspect, and safe to hand-edit when Portweave is not running. Entries whose worktree directory no longer exists are pruned automatically on the next run.
- **The lock** is a directory mutex at `~/.config/portweave/registry.lock`, held only for the duration of a read-modify-write. A lock older than 30 seconds is treated as stale and reclaimed, so a crashed process can't wedge the registry permanently.
- **Per-project output** is `.portweave/current.env` in the worktree, rewritten on every `portweave run`. Add `.portweave/` to `.gitignore`.
- **No daemon, no network, no telemetry.** Every invocation is a one-shot process that coordinates solely through the lock-protected registry file.

## Roadmap

These are directional and not commitments. Nothing here is required for, or part of, v0.

- Agent-spawned ephemeral allocations with a time-to-live.
- A cross-project discovery layer so services can find each other by name.
- Local dev DNS (a hostname that resolves to a worktree's allocated port).
- Optionally team-shared registries.
- First-party framework adapters (a Vite plugin, a Next.js plugin) layered over the runtime API.

## Contributing

The design rationale lives in [`.ai/DESIGN.md`](.ai/DESIGN.md) and the reasoning behind individual decisions in [`.ai/decision-log.md`](.ai/decision-log.md). Read those first for non-trivial work.

The full quality suite runs with:

```bash
npm install
npm run dev-workflow      # format, lint, typecheck, dup/dead-code, tests — run before pushing
```

Features are specified before they're built; see the spec workflow under [`.ai/specs/`](.ai/specs/).

## License and resources

Released under the [MIT License](LICENSE).

- [Design document](.ai/DESIGN.md)
- [Decision log](.ai/decision-log.md)
- [Specs](.ai/specs/)
- [Example configuration](examples/web-app.config.json)
