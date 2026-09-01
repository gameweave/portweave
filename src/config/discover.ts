import { access } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import type { PortweaveError } from '../errors.ts'
import { ok, type Result } from '../result.ts'
import { type Config, loadConfig } from './index.ts'

/**
 * Canonical filename of the project's portweave configuration.
 */
export const CONFIG_FILENAME = 'portweave.config.json'

export interface DiscoveredConfig {
  readonly config: Config
  /** Directory holding the config — where `.portweave/current.env` belongs. */
  readonly projectRoot: string
}

/**
 * Walk upward from `start` toward the filesystem root, checking for
 * `portweave.config.json` at each level. Returns the directory containing the
 * first matching file, or `null` if none is found.
 */
export async function findConfigUpward(
  start: string,
): Promise<null | { dir: string }> {
  let dir = resolvePath(start)
  for (;;) {
    const candidate = resolvePath(dir, CONFIG_FILENAME)
    try {
      await access(candidate)
      return { dir }
    } catch (caught: unknown) {
      // Only swallow ENOENT — the file doesn't exist at this level; keep walking.
      // All other errors (EACCES, EPERM, etc.) propagate so callers can diagnose
      // permission issues rather than getting a misleading RUNTIME_CONFIG_NOT_FOUND.
      if (
        !(
          caught instanceof Error &&
          'code' in caught &&
          (caught as { code: unknown }).code === 'ENOENT'
        )
      ) {
        throw caught
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      // Reached filesystem root without finding a config file.
      return null
    }
    dir = parent
  }
}

/**
 * Find and load the project config for `cwd`, walking upward.
 *
 * Every surface — `run`, `show`, `slots`, and the runtime library — resolves the
 * config through here, so all four agree on which file is in effect and on what
 * counts as the project root. They previously disagreed three ways (`run` looked
 * only in the exact cwd, `show`/`slots` only at the git worktree root, the
 * runtime walked up), which meant `portweave run` from a monorepo package
 * directory failed with PW0101 even though `portweave show` in the same
 * directory worked.
 *
 * An explicit `configPath` bypasses the walk entirely. Returns `ok(null)` when
 * no config exists, leaving the "is that an error?" call to the caller — the CLI
 * reports PW0101, the runtime may fall back to anonymous mode.
 */
export async function discoverConfig(
  cwd: string,
  configPath?: string,
): Promise<Result<DiscoveredConfig | null, PortweaveError>> {
  if (configPath !== undefined) {
    const absolute = resolvePath(cwd, configPath)
    const loaded = await loadConfig(dirname(absolute), {
      configPath: absolute,
    })
    if (!loaded.ok) {
      return loaded
    }
    return ok({ config: loaded.value, projectRoot: dirname(absolute) })
  }

  const found = await findConfigUpward(cwd)
  if (found === null) {
    return ok(null)
  }
  const loaded = await loadConfig(found.dir, { configPath: CONFIG_FILENAME })
  if (!loaded.ok) {
    return loaded
  }
  return ok({ config: loaded.value, projectRoot: found.dir })
}
