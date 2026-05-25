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
import { atomicWriteDotenv, ensurePortweaveDir } from './writer.ts'

export interface ResolvedEnv {
  readonly createdPortweaveDir: boolean
  readonly currentEnvPath: string
  readonly env: Readonly<Record<string, string>>
}

export async function resolveEnv(
  allocation: Allocation,
  config: Config,
  projectRoot: string,
): Promise<Result<ResolvedEnv, PortweaveErrorType>> {
  let computed: Record<string, string>
  try {
    computed = buildEnvMap(allocation, config)
  } catch (caught: unknown) {
    if (caught instanceof PortweaveError) {
      return err(caught)
    }
    throw caught
  }

  const dotenvPath = resolve(projectRoot, '.env')
  const dotenvResult = await readDotenvFile(dotenvPath)
  if (!dotenvResult.ok) {
    return dotenvResult
  }

  const final = applyDotenvOverrides(computed, dotenvResult.value)
  const { created } = await ensurePortweaveDir(projectRoot)
  const currentEnvPath = resolve(projectRoot, '.portweave/current.env')
  await atomicWriteDotenv(currentEnvPath, final)

  return ok({ createdPortweaveDir: created, currentEnvPath, env: final })
}
