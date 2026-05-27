import { access } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'

/**
 * Canonical filename of the project's portweave configuration. The runtime
 * (and the CLI via `loadConfig`) discover this name at the project root.
 */
export const CONFIG_FILENAME = 'portweave.config.json'

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
