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
- [Preview dashboard (`portweave panel`)](#preview-dashboard-portweave-panel)
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
4. Check whether the project's `.env` is SHARED across worktrees (symlinked
   into each one, or committed). If it is, add `"envAuthority": "portweave"`
   at the top level — otherwise `.env` overrides the allocation and nothing
   changes. An explicit `VAR=… <command>` in the shell still wins either way.
5. Check whether any port must be registered somewhere OUTSIDE this machine —
   an OAuth redirect URI (Auth0, Google, GitHub), a webhook URL. If so, add a
   `pool` block so the candidate ports are a finite, listable set:
       "pool": { "mode": "slots", "basePort": 3000, "stride": 10, "slots": 10 }
   Pick `basePort` so slot 0 equals the ports the project already uses, and
   register every slot once with `portweave slots --template '<url>'`.
6. In `package.json`, wrap each dev/test command that needs ports with
   `portweave run -- <command>` (e.g. `"dev": "portweave run -- vite"`).
   In a monorepo, wrap EACH workspace's own script, not just the root one:
   task runners such as Turborepo filter the child environment by default
   (`envMode: "strict"`), which silently strips the injected vars. Verify
   with `turbo run dev --dry=json`.
   A dev process that must run in only one worktree at a time — a worker
   registering against one shared cloud project, say — goes behind
   `portweave --primary-only run -- <command>` instead.
7. For config files evaluated at startup (`vite.config`, `next.config`,
   `vitest.config`), do not read `process.env` — import the allocation from
   the async runtime API instead:
       import { ports } from 'portweave/runtime'
       const p = await ports()
       if (!p.ok) throw new Error(`${p.error.message} (${p.error.code})`)
       // then use p.value.<serviceName>
   Two exceptions. Skip this for a config that also runs in CI or a cloud
   build, where there is no allocation — keep reading `process.env` there and
   guard the runtime call behind a local-dev-only branch. And a CommonJS
   config (no top-level `await`) cannot use the async API at all: read
   `.portweave/current.env` with `dotenv` instead.
8. Replace any hardcoded port literals with reads of the injected env vars.
9. Add `.portweave/` to `.gitignore`.
10. Verify: run the wrapped dev script and confirm the `[portweave]` banner
    lists every service and the app binds the allocated ports. Then run it in
    a second worktree at the same time and confirm both come up.

CLI note: global flags go BEFORE the subcommand —
`portweave --count 3 run -- npm run dev`, never after `run`.

Shell note: `portweave run` spawns without a shell, so `-p $WEB_PORT` in the
argv is expanded by the OUTER shell before injection and arrives empty. Use
`portweave run -- sh -c 'exec <command> -p $WEB_PORT'` when a port has to be
passed as a flag (`exec` so signals still reach the process).
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

Portweave looks for `portweave.config.json`, starting in the working directory and walking up toward the filesystem root — so it is found from a subdirectory, which is what makes per-workspace scripts work in a monorepo. Every surface resolves it the same way (`run`, `show`, `slots`, and the runtime library), and `.portweave/current.env` is always written beside the config it was resolved from. Here is a configuration that exercises every supported field:

```json
{
  "$schema": "https://raw.githubusercontent.com/gameweave/portweave/main/schema/v1.json",
  "projectName": "My App",
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

| Field                          | Required     | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$schema`                      | optional     | A schema URL string. Ignored at runtime; useful for editor autocompletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `services`                     | **required** | An object with at least one entry. Each key is a service name in kebab-case (`^[a-z][a-z0-9-]*$`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `services.<name>.envVar`       | **required** | The environment-variable name the allocated port is exposed as. Must match `^[A-Z][A-Z0-9_]*$`. Must be unique across all services.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `services.<name>.group`        | optional     | A group label. Services sharing a group are allocated as a contiguous block, so they move together (handy when a tool expects two adjacent ports).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `services.<name>.discoveryEnv` | optional     | A map of additional environment variables to derived values. Each value is a template; `${serviceName}` is replaced with that service's allocated port, `${pw:<field>}` with worktree metadata, and the reserved `${namespace}` token with the worktree namespace (all three covered below). Keys must be valid env-var names, unique across the whole config, and must not start with the reserved `PORTWEAVE_` prefix. A `${name}` that matches neither a declared service, a known metadata field, nor the reserved `${namespace}` token is a configuration error. Entries may be declared on any service — injection is always global — and the [panel](#preview-dashboard-portweave-panel) shows each `http(s)` URL on the row of the service its template references, not necessarily the declaring service. |

A copyable starting point lives at [`examples/web-app.config.json`](examples/web-app.config.json).

Three optional **top-level** fields are not service settings:

| Field          | Default    | What it does                                                                                                                                                                                               |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectName`  | git dir    | A 1–100 character display label the [panel](#preview-dashboard-portweave-panel) uses to title this project's group. No effect on allocation.                                                               |
| `envAuthority` | `"dotenv"` | Who wins when the project `.env` names a key Portweave also computes. See [Choosing who wins: `envAuthority`](#choosing-who-wins-envauthority).                                                            |
| `pool`         | first-fit  | Allocate from a fixed set of slots rather than scanning a machine-wide range, so the full set of possible ports is finite and listable. See [Fixed slots](#fixed-slots-when-ports-must-be-pre-registered). |

`services.<name>.preferred` is **deprecated and ignored**; it was never read by the allocator. Portweave warns when it sees one and will remove the field in 0.9. Use `pool` instead — it is the real answer to "I need to know which ports this can land on".

Notes that affect how you write templates:

- `${serviceName}` always resolves to the **allocated** port for that service, even if you override the service's own `envVar` through a project `.env` file. Derived URLs stay internally consistent.
- `${pw:<field>}` resolves Portweave metadata for the current worktree. Available fields: `namespace` (`main` or `<slug>-<hash>`), `worktreeRoot` (absolute path), and `gitCommonDir` (the shared `.git` directory, or empty string outside a git repo). Compose them freely, e.g. `"OTEL_SERVICE_NAME": "gw-${pw:namespace}"`.
- `${namespace}` is a **reserved** shorthand for `${pw:namespace}` — the worktree namespace. It always resolves to the namespace, even if a service is literally named `namespace` (that service's port is still reachable through its own `envVar`, just not through `${namespace}`). It is the ergonomic primitive for isolating **non-port** resources per worktree — e.g. `"DDB_TABLE_PREFIX": "local-${namespace}"`, `"REGISTRY_BUCKET_PREFIX": "gw-${namespace}"`, or a PM2 process name. See [Isolating non-port resources per worktree](#isolating-non-port-resources-per-worktree).
- The configuration file is strict: unknown top-level keys and unknown service fields are rejected with a `PW0102` error that names the offending path.

### Injected metadata: `PORTWEAVE_NAMESPACE`

Every `portweave run` injects `PORTWEAVE_NAMESPACE` into the child process (and writes it to `.portweave/current.env`) with no configuration required. Its value is the worktree namespace Portweave allocated under — `main` for the primary worktree, `<slug>-<hash>` for others.

This is the primitive for keeping worktrees from colliding in shared, single-instance daemons. The canonical case is PM2: name each app `<service>-${process.env.PORTWEAVE_NAMESPACE}` (e.g. in `ecosystem.config.cjs`) so two worktrees running the same stack register distinct process names in the one PM2 daemon. Portweave allocates the ports and hands you the namespace; it never manages processes itself.

`PORTWEAVE_NAMESPACE` is authoritative: it always reports the namespace Portweave used, so a value set in your project `.env` or parent environment does not change what the child observes (an explicit value is still honored as an _override of which namespace gets derived_ — set it before invoking `portweave run`).

### Fixed slots: when ports must be pre-registered

By default Portweave picks the first free block in a wide pool, so a worktree's ports are stable but not predictable _before_ it first runs. That is a problem whenever something outside your machine has to know the port in advance — an OAuth provider's redirect-URI allow-list is the common case, and none of them will wildcard a localhost port.

Slot mode makes the candidate set finite and enumerable. Slot `i` spans `[basePort + i*stride, basePort + i*stride + serviceCount - 1]`:

```json
{
  "pool": {
    "mode": "slots",
    "basePort": 3000,
    "stride": 10,
    "slots": 10,
    "primarySlot": 0
  },
  "services": {
    "web": { "envVar": "WEB_PORT" },
    "api": { "envVar": "API_PORT" }
  }
}
```

With two services that gives slot 0 = 3000/3001, slot 1 = 3010/3011, … slot 9 = 3090/3091 — ten possibilities you can register once and forget.

| Field         | Required     | Rules                                                                                                 |
| ------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `mode`        | **required** | Only `"slots"`. Omitting the whole `pool` block keeps the default first-fit behaviour.                |
| `basePort`    | **required** | First port of slot 0. Must be ≥ 1024 (below that is privileged on POSIX).                             |
| `stride`      | **required** | Distance between slot base ports. Must be ≥ the number of services, so adjacent slots cannot overlap. |
| `slots`       | **required** | How many slots exist. Allocation fails rather than drifting outside the set.                          |
| `primarySlot` | optional (0) | The slot pinned to the primary worktree.                                                              |

Three behaviours are deliberate and worth knowing:

- **The primary worktree always gets `primarySlot`.** If those ports are occupied, allocation fails with `PW0402` instead of moving — silently drifting off the pinned slot would break whatever was pre-registered against it.
- **A busy port retires its whole slot, not just itself.** First-fit would slide one port forward; slot mode jumps to the next slot base, so bases stay on the declared stride no matter how many probes fail.

- **Editing the pool re-rolls worktrees that no longer fit it.** Allocations are otherwise sticky and reused unconditionally, but the pool block is config: change `basePort`, `stride`, `slots` or `primarySlot` and any worktree sitting outside the new geometry gets a fresh block on the next run. Without that, those worktrees would keep working on ports that are no longer in the set you registered — the ports still bind, so nothing looks wrong until a login fails.

`PORTWEAVE_POOL_RANGE` is ignored in slot mode (Portweave says so on stderr) — the geometry comes from the config, which is the point.

Use [`portweave slots`](#portweave-slots) to print the set, and `--template` to render it straight into whatever allow-list needs it.

### Choosing who wins: `envAuthority`

By default, an explicit entry in your project `.env` beats Portweave's computed value for the same key. That is the right default: pinning a port in `.env` should work.

It is the wrong default for one specific and increasingly common shape — a **`.env` that is shared across worktrees**, typically symlinked into each one from a main checkout. There, the file physically cannot carry a per-worktree port, so letting it win makes the whole allocation inert. Setting `"envAuthority": "portweave"` inverts the middle layer:

| Layer                    | `"dotenv"` (default) | `"portweave"` |
| ------------------------ | -------------------- | ------------- |
| Parent process env       | wins                 | wins          |
| Project `.env`           | wins over computed   | ignored       |
| Portweave computed value | fallback             | wins          |

An ad-hoc override still works either way, because the parent environment is above both: `API_PORT=4000 portweave run -- npm run dev`.

Under `"portweave"`, Portweave does not read `.env` at all. That has a useful side effect: a line the [minimal dotenv parser](#errors-and-recovery) cannot handle — a pasted multi-line PEM, say — can no longer fail your dev command with `PW0502`.

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
| `--primary-only`  | With `run`: do nothing and exit `0` unless this is the primary worktree (see below).                    |
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

**`--primary-only`** turns the command into a no-op outside the primary worktree: Portweave writes one line to stderr and exits `0` without spawning anything.

```bash
portweave --primary-only run -- npm run worker
```

This is for a dev process that is a singleton for reasons unrelated to ports — the shape that motivated it is a worker registering itself against a single shared cloud project, where a second copy does not collide on a port, it quietly splits the work in half. Exiting `0` rather than failing matters when the command is one task in a parallel runner such as `turbo dev`: the other tasks still succeed.

To run it in a linked worktree anyway, set `PORTWEAVE_PRIMARY=1`. (Deliberately not `PORTWEAVE_NAMESPACE=main`, which would also move the worktree's port block.)

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

### `portweave slots`

Prints every port block the project can allocate. Slot mode only (`pool.mode: "slots"`); it is pure computation — no registry lock, no allocation, no `.portweave` write.

```bash
$ portweave slots
slot 0 (primary)  web=3000 api=3001
slot 1  web=3010 api=3011
slot 2  web=3020 api=3021
```

`--template` renders a `${service}` template once per slot and prints nothing else, so the output drops straight into whatever wants the list. Repeat the flag for more than one template.

```bash
$ portweave slots --template 'http://localhost:${web}/auth/callback'
http://localhost:3000/auth/callback
http://localhost:3010/auth/callback
http://localhost:3020/auth/callback

# register every candidate with an OAuth provider in one shot
$ auth0 apps update "$CLIENT_ID" \
    --callbacks "$(portweave slots --template 'http://localhost:${web}/auth/callback' | paste -sd,)"
```

Templates use the same evaluator as `discoveryEnv`, so `${pw:<field>}` and the reserved `${namespace}` token work here too. `--json` emits the pool geometry plus per-slot `ports` and `rendered` maps.

### `portweave prune`

Removes the current worktree's allocation from the machine-wide registry, freeing its port block — handy when you're done with a worktree (for example after its PR merged) and want the ports back.

```bash
portweave prune                  # prune the current worktree's allocation
portweave prune --path ../old    # prune another worktree without cd-ing into it
```

It removes only the targeted allocation, leaves every other entry untouched, and works whether or not the panel is running. If the worktree has no allocation it exits `1` and says so. Deleting the worktree's files is left to you (`git worktree remove …`); `prune` only reclaims the port allocation.

## Preview dashboard (`portweave panel`)

`portweave show` answers "what ports does _this_ worktree have?" The panel answers the cross-cutting version: stand back and see _everything_ allocated on the machine at once — and act on it. Because ports are dynamic, a feature worktree's web app might be on `30002` today and `30107` tomorrow, so the panel gives you a stable home page of clickable preview links instead of a port hunt, plus lightweight worktree triage and cleanup.

```bash
portweave panel
portweave panel --port 8080   # use a different port
```

It starts a local web dashboard of every machine-wide allocation, grouped **project → worktree → service** — groups are collapsible, and the collapse state is remembered in your browser. For each worktree it shows:

- **A clickable link for every service.** An `http(s)` `discoveryEnv` URL is shown on the row of the service its template references — `"EXPO_PUBLIC_API_URL": "http://localhost:${api}"` lands on `api`'s row no matter which service declares it (a template referencing no service stays with its declaring service; one referencing several services is a composite value, not a link). Every service without such a URL gets a synthesized `http://localhost:<port>` link, so each row is one click from a preview. A per-port **live / not-running** badge distinguishes an active server from a stale allocation.
- **Triage signals.** Each worktree shows its **on-disk size**, whether it is the **main checkout** or a **linked worktree**, and — when the GitHub CLI (`gh`) is installed and authenticated — its **PR status** (open / closed / merged), resolved by running `gh` inside the worktree. A _linked_ worktree whose PR is merged-or-closed **and** whose working tree is clean is flagged **safe to prune**; the main checkout is never flagged, and a merged-but-dirty worktree is deliberately held back.
- **Cleanup and quick actions.** **Prune** reclaims a worktree's allocation (the same operation as [`portweave prune`](#portweave-prune)); the panel also shows the exact `git worktree remove …` command to copy — it never deletes directories itself. On macOS, quick actions open the worktree in your **editor** or a **terminal**, or copy its path.

Operational notes:

- Default port **`6767`**; override with `--port <n>`. If that port is busy, the panel automatically falls forward to the next free port and prints the URL it actually bound.
- Binds **loopback only** (`127.0.0.1`) and runs in the **foreground** on demand — press **Ctrl-C** to stop. There is no daemon.
- **Viewing never writes the registry.** The one mutating action, **prune**, is guarded by `Origin`/`Host` checks, a per-session CSRF token, and explicit confirmation — a loopback server is still reachable by any page open in your browser. PR status and disk sizes are cached briefly so refreshes stay fast; if `gh` is missing or unauthenticated, PR status is omitted and everything else renders normally.

**Tip — label your projects.** The panel groups worktrees by git repository and labels each group with the optional [`projectName`](#configuration) field from `portweave.config.json`, falling back to the repository's directory name. Set it for a clean, stable label:

```json
{
  "projectName": "My App",
  "services": { "web": { "envVar": "WEB_PORT" } }
}
```

**Tip — choose your editor.** The "open in editor" action uses [`PORTWEAVE_EDITOR`](#environment-variable-overrides) when set (e.g. `PORTWEAVE_EDITOR=cursor`), otherwise the first of `code` or `cursor` on your `PATH`. The value must be a single executable (a name on `PATH` or an absolute path) — it runs without a shell, so `open -a Cursor` won't work.

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

| Variable                    | Effect                                                                                                                                                                            | Default                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `PORTWEAVE_OFFSET`          | Forces a specific allocation offset. Must be a non-negative integer. Useful for pinning a deterministic block in CI or on a shared machine.                                       | derived from the worktree path                          |
| `PORTWEAVE_NAMESPACE`       | Overrides the namespace string (the value exposed as `PORTWEAVE_NAMESPACE` and used in the banner). The value is slugified.                                                       | `main` for the main worktree; `<slug>-<hash>` otherwise |
| `PORTWEAVE_POOL_RANGE`      | Overrides the candidate port pool. Format `<start>-<end>`; both integers, `start >= 1024`, `end > start`. Ignored in [slot mode](#fixed-slots-when-ports-must-be-pre-registered). | `30000-60000`                                           |
| `PORTWEAVE_PRIMARY`         | Set to `1` to make `--primary-only` run the command in a linked worktree too.                                                                                                     | unset                                                   |
| `PORTWEAVE_LOCK_TIMEOUT_MS` | How long to wait when acquiring the registry lock before giving up with `PW0301`.                                                                                                 | ~2500 ms (100 retries × 25 ms)                          |
| `XDG_CONFIG_HOME`           | Base directory for the registry. Portweave uses `$XDG_CONFIG_HOME/portweave/`.                                                                                                    | `~/.config`                                             |

Malformed values for `PORTWEAVE_POOL_RANGE` and `PORTWEAVE_LOCK_TIMEOUT_MS` fall back to the default; the pool-range case also prints a one-line warning to stderr so a typo doesn't silently change allocations. A non-integer `PORTWEAVE_OFFSET` is a hard error (`PW0202`).

`PORTWEAVE_EDITOR` selects the editor the [`portweave panel`](#preview-dashboard-portweave-panel) "open in editor" action launches: set it to a single executable on your `PATH` (e.g. `cursor`) or an absolute path — it is run without a shell. When unset, the panel uses the first of `code` or `cursor` found on `PATH`.

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
| `PW0401` | No free port block large enough in the pool.                                  | Widen the pool with `PORTWEAVE_POOL_RANGE` (first-fit) or raise `pool.slots` (slot mode), or remove stale entries from the registry.                                         |
| `PW0402` | The primary worktree's pinned slot is occupied (slot mode only).              | Free the port the message names, or `portweave prune --path <dir>` if a stale worktree entry holds it. Portweave will not drift the primary off its slot.                    |
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
