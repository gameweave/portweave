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
  readonly env: Readonly<Record<string, string>>
  readonly ports: Readonly<Record<string, number>>
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
    env: envResult.value.env,
    ports: allocResult.value.allocation.ports,
  })
}

export async function allocation(
  opts?: PortsOptions,
): Promise<Result<Allocation, PortweaveError>> {
  const result = await resolveRuntime(opts)
  if (!result.ok) {
    return result
  }
  return ok(result.value.allocation)
}

export async function env(
  opts?: PortsOptions,
): Promise<Result<Record<string, string>, PortweaveError>> {
  const result = await resolveRuntime(opts)
  if (!result.ok) {
    return result
  }
  return ok({ ...result.value.env })
}

export async function ports(
  opts?: PortsOptions,
): Promise<Result<Record<string, number>, PortweaveError>> {
  const result = await resolveRuntime(opts)
  if (!result.ok) {
    return result
  }
  return ok({ ...result.value.ports })
}
