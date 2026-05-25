import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const _require = createRequire(import.meta.url)

/**
 * Resolved path to the tsx CLI binary, used to run TypeScript fixtures in
 * forked child processes without a separate compile step.
 */
export const TSX_PATH: string = _require.resolve('tsx/cli')

export interface ConcurrentTestDirs {
  configDir: string
  workerRoots: string[]
}

/**
 * Create a fresh configDir and N workerRoot directories for a concurrent test.
 */
export async function makeConcurrentDirs(
  configPrefix: string,
  rootPrefix: string,
  count: number,
): Promise<ConcurrentTestDirs> {
  const configDir = await mkdtemp(join(tmpdir(), configPrefix))
  const workerRoots: string[] = []
  for (let i = 0; i < count; i++) {
    const root = await mkdtemp(join(tmpdir(), `${rootPrefix}${i.toString()}-`))
    workerRoots.push(root)
  }
  return { configDir, workerRoots }
}

/**
 * Remove all directories created by makeConcurrentDirs.
 */
export async function cleanupConcurrentDirs(
  dirs: ConcurrentTestDirs,
): Promise<void> {
  await rm(dirs.configDir, { force: true, recursive: true })
  for (const root of dirs.workerRoots) {
    await rm(root, { force: true, recursive: true })
  }
}
