import { resolve } from 'node:path'
import type { Allocation } from '../allocator/allocate.ts'
import type { Config } from '../config/index.ts'
import {
  PortweaveError,
  type PortweaveError as PortweaveErrorType,
} from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { buildEnvMap } from './build.ts'
import { applyDotenvOverrides, readDotenvFile } from './dotenv-merge.ts'
import { PORTWEAVE_NAMESPACE_VAR } from './metadata.ts'
import { atomicWriteDotenv, ensurePortweaveDir } from './writer.ts'

export interface ResolvedEnv {
  readonly createdPortweaveDir: boolean
  readonly currentEnvPath: string
  readonly env: Readonly<Record<string, string>>
}

/**
 * Compute the env map exactly as `resolveEnv` would inject it, with no
 * filesystem side effects.
 *
 * `show` needs the injected values without writing `.portweave/current.env`.
 * It used to call `buildEnvMap` directly, which skipped the `.env` layer
 * entirely and so could report values that differed from what `run` actually
 * put in the child's environment. Both paths now share this function.
 */
export async function computeEnvMap(
  allocation: Allocation,
  config: Config,
  projectRoot: string,
): Promise<Result<Record<string, string>, PortweaveErrorType>> {
  let computed: Record<string, string>
  try {
    computed = buildEnvMap(allocation, config)
  } catch (caught: unknown) {
    if (caught instanceof PortweaveError) {
      return err(caught)
    }
    throw caught
  }

  // Under `envAuthority: "portweave"` the project `.env` has no say, so the
  // file is not read at all. That also means a `.env` line this parser cannot
  // handle can no longer take `portweave run` down with PW0502 — relevant for
  // the shared, hand-edited, secret-bearing `.env` files that motivated the
  // setting in the first place.
  let overrides: Record<string, string> = {}
  if (config.envAuthority === 'dotenv') {
    const dotenvResult = await readDotenvFile(resolve(projectRoot, '.env'))
    if (!dotenvResult.ok) {
      return dotenvResult
    }
    overrides = dotenvResult.value
  }

  const final = applyDotenvOverrides(computed, overrides)
  // PORTWEAVE_NAMESPACE is an authoritative report of the namespace Portweave
  // used to allocate — not a user-tunable default. Re-assert it past the .env
  // override so a `.env` entry can't make the reported value diverge from the
  // value the registry was keyed under. (run.ts does the same past process env.)
  final[PORTWEAVE_NAMESPACE_VAR] = allocation.namespace
  return ok(final)
}

export async function resolveEnv(
  allocation: Allocation,
  config: Config,
  projectRoot: string,
): Promise<Result<ResolvedEnv, PortweaveErrorType>> {
  const computedResult = await computeEnvMap(allocation, config, projectRoot)
  if (!computedResult.ok) {
    return computedResult
  }
  const final = computedResult.value
  const { created } = await ensurePortweaveDir(projectRoot)
  const currentEnvPath = resolve(projectRoot, '.portweave/current.env')
  await atomicWriteDotenv(currentEnvPath, final)

  return ok({ createdPortweaveDir: created, currentEnvPath, env: final })
}
