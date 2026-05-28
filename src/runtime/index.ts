import { dirname, resolve as resolvePath } from 'node:path'
import { allocate, type Allocation } from '../allocator/allocate.ts'
import {
  type Config,
  loadConfig,
  synthesizeAnonymousConfig,
} from '../config/index.ts'
import { resolveEnv } from '../env/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { resolveAllocationKey } from '../worktree/key.ts'
import { CONFIG_FILENAME, findConfigUpward } from './upward-walk.ts'

const PORT_MIN = 1
const PORT_MAX = 65535

export interface PortsOptions {
  /** Explicit config path; bypasses upward-walk discovery. Resolved against `cwd` if relative. */
  readonly configPath?: string
  /** Anonymous-mode fallback. If no `portweave.config.json` is found AND `count` is provided, synthesize a config with N services (`port-1`..`port-N` / `PORT_1`..`PORT_N`). */
  readonly count?: number
  /** Working directory used for worktree-key resolution and config discovery. Defaults to `process.cwd()`. */
  readonly cwd?: string
}

interface RuntimeOutcome {
  readonly allocation: Allocation
  readonly config: Config
  readonly env: Readonly<Record<string, string>>
}

async function resolveConfigForRuntime(
  cwd: string,
  opts: PortsOptions | undefined,
): Promise<Result<{ config: Config; projectRoot: string }, PortweaveError>> {
  // Explicit configPath wins — no upward walk.
  if (opts?.configPath !== undefined) {
    const absConfigPath = resolvePath(cwd, opts.configPath)
    const loaded = await loadConfig(dirname(absConfigPath), {
      configPath: absConfigPath,
    })
    if (!loaded.ok) {
      return loaded
    }
    return ok({ config: loaded.value, projectRoot: dirname(absConfigPath) })
  }

  // Upward walk: cwd → parent → ... → filesystem root.
  const found = await findConfigUpward(cwd)
  if (found !== null) {
    const loaded = await loadConfig(found.dir, {
      configPath: CONFIG_FILENAME,
    })
    if (!loaded.ok) {
      return loaded
    }
    return ok({ config: loaded.value, projectRoot: found.dir })
  }

  // No config file found. Anonymous fallback if `count` is provided.
  if (opts?.count !== undefined) {
    const anon = synthesizeAnonymousConfig(opts.count)
    if (!anon.ok) {
      return anon
    }
    return ok({ config: anon.value, projectRoot: cwd })
  }

  // Neither config file nor `count` provided — typed error.
  return err(
    new PortweaveError(
      PW_ERROR_CODES.RUNTIME_CONFIG_NOT_FOUND,
      `no ${CONFIG_FILENAME} found by walking up from ${cwd}, and no { count } option was provided`,
    ),
  )
}

/**
 * Run the full allocate → resolveEnv pipeline once and return its outcome.
 *
 * Async because `allocate()` and `resolveEnv()` are async — they go through
 * the registry lock and the `.portweave/current.env` write. The early
 * `resolveAllocationKey()` call is sync (it returns a `Result`), so the
 * early-return-on-`!keyResult.ok` path is plain `Result` propagation, not
 * a Promise boundary.
 */
async function resolveRuntime(
  opts?: PortsOptions,
): Promise<Result<RuntimeOutcome, PortweaveError>> {
  const cwd = resolvePath(opts?.cwd ?? process.cwd())

  const keyResult = resolveAllocationKey(cwd)
  if (!keyResult.ok) {
    return keyResult
  }

  const key = keyResult.value

  const configResult = await resolveConfigForRuntime(cwd, opts)
  if (!configResult.ok) {
    return configResult
  }

  const { config, projectRoot } = configResult.value

  const allocResult = await allocate(key, config)
  if (!allocResult.ok) {
    return allocResult
  }

  const envResult = await resolveEnv(
    allocResult.value.allocation,
    config,
    projectRoot,
  )
  if (!envResult.ok) {
    return envResult
  }

  return ok({
    allocation: allocResult.value.allocation,
    config,
    env: envResult.value.env,
  })
}

/**
 * Return the raw `Allocation` object from the registry: namespace, allocation key,
 * and the unmodified `ports` map the allocator picked.
 *
 * Does NOT apply `.env` overrides. Use this when you need to inspect what
 * Portweave allocated (debugging, introspection, registry tools). For values
 * a config consumer should actually bind to or pass through to a child
 * process, prefer `ports()` or `env()` instead — those apply `.env` overrides
 * so a user-pinned value wins.
 */
export async function allocation(
  opts?: PortsOptions,
): Promise<Result<Allocation, PortweaveError>> {
  const result = await resolveRuntime(opts)
  if (!result.ok) {
    return result
  }
  return ok(result.value.allocation)
}

/**
 * Return the fully merged env map (string keys, string values): per-service
 * envVar entries plus any `discoveryEnv` templates, with project-`.env`
 * overrides applied to Portweave-known keys.
 *
 * Discovery templates always resolve against the *allocated* port even when
 * the matching envVar is overridden — see decision-log row #26. So overriding
 * `API_PORT` in `.env` updates `env().API_PORT` but does not transitively
 * rewrite `${api}` placeholders inside discovery URLs.
 */
export async function env(
  opts?: PortsOptions,
): Promise<Result<Record<string, string>, PortweaveError>> {
  const result = await resolveRuntime(opts)
  if (!result.ok) {
    return result
  }
  return ok({ ...result.value.env })
}

/**
 * Return the per-service numeric port map, with `.env` overrides applied.
 *
 * Each key is a service name from `portweave.config.json` (or `port-1`..`port-N`
 * in anonymous mode); each value is the port the consumer should bind to /
 * connect on. If `.env` pins a service's envVar (e.g. `WEB_PORT=6766`), the
 * pinned value wins over the raw allocation, matching the precedence the CLI
 * uses when injecting into the child process.
 *
 * Returns `PW0503` if a `.env` override exists for a service envVar but is not
 * a valid port integer in [1, 65535] — strict-error rather than silent fallback
 * because the caller expects a number it can bind to.
 *
 * For raw allocator output without override application, call `allocation()`.
 */
export async function ports(
  opts?: PortsOptions,
): Promise<Result<Record<string, number>, PortweaveError>> {
  const result = await resolveRuntime(opts)
  if (!result.ok) {
    return result
  }
  const { config, env: mergedEnv } = result.value
  const portsMap: Record<string, number> = {}
  for (const service of config.services) {
    // resolveEnv always populates service.envVar (build.ts iterates
    // config.services). Type system enforces this; a missing key would be a
    // load-bearing-invariant bug, not a recoverable case.
    const stringValue = mergedEnv[service.envVar]
    const parsed = parsePortInteger(stringValue)
    if (parsed === null) {
      return err(
        new PortweaveError(
          PW_ERROR_CODES.ENV_DOTENV_PORT_OVERRIDE_INVALID,
          `.env override for ${service.envVar} (service "${service.name}") is "${stringValue}", which is not a valid port integer in [${String(PORT_MIN)}, ${String(PORT_MAX)}]`,
        ),
      )
    }
    portsMap[service.name] = parsed
  }
  return ok(portsMap)
}

function parsePortInteger(value: string): null | number {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < PORT_MIN || parsed > PORT_MAX) {
    return null
  }
  return parsed
}
