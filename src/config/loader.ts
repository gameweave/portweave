import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { type Config, validateAndNormalizeConfig } from './schema.ts'

const DEFAULT_CONFIG_FILENAME = 'portweave.config.json'

export interface LoadConfigOptions {
  configPath?: string
}

function resolveConfigPath(
  cwd: string,
  configPath: string | undefined,
): string {
  if (configPath === undefined) {
    return resolve(cwd, DEFAULT_CONFIG_FILENAME)
  }
  return isAbsolute(configPath) ? configPath : resolve(cwd, configPath)
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

interface ReadOutcome {
  contents?: string
  missing?: true
  problem?: PortweaveError
}

async function readConfigFile(absolutePath: string): Promise<ReadOutcome> {
  try {
    const contents = await readFile(absolutePath, 'utf8')
    return { contents }
  } catch (caught: unknown) {
    if (
      caught instanceof Error &&
      'code' in caught &&
      (caught as { code: unknown }).code === 'ENOENT'
    ) {
      return { missing: true }
    }
    return {
      problem: new PortweaveError(
        PW_ERROR_CODES.CONFIG_INVALID,
        `failed to read ${absolutePath}: ${describe(caught)}`,
      ),
    }
  }
}

function parseJson(
  contents: string,
  absolutePath: string,
): Result<unknown, PortweaveError> {
  try {
    return ok(JSON.parse(contents))
  } catch (caught: unknown) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CONFIG_INVALID,
        `failed to parse JSON at ${absolutePath}: ${describe(caught)}`,
      ),
    )
  }
}

export async function loadConfig(
  cwd: string,
  opts?: LoadConfigOptions,
): Promise<Result<Config, PortweaveError>> {
  const absolutePath = resolveConfigPath(cwd, opts?.configPath)
  const outcome = await readConfigFile(absolutePath)
  if (outcome.missing === true) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CONFIG_MISSING,
        `no portweave.config.json at ${absolutePath}`,
      ),
    )
  }
  if (outcome.problem !== undefined) {
    return err(outcome.problem)
  }
  const contents = outcome.contents ?? ''
  const parsed = parseJson(contents, absolutePath)
  if (!parsed.ok) {
    return parsed
  }
  return validateAndNormalizeConfig(parsed.value, {
    source: 'file',
    sourcePath: absolutePath,
  })
}
