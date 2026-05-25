import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const TMP_SIBLING_TTL_MS = 60_000

export async function atomicWriteRegistry(
  path: string,
  contents: string,
): Promise<void> {
  const tempPath = `${path}.tmp.${process.pid.toString()}.${Date.now().toString()}`
  await writeFile(tempPath, contents, { encoding: 'utf-8', mode: 0o600 })
  await rename(tempPath, path)
}

export async function pruneStaleTempFiles(path: string): Promise<void> {
  const dir = dirname(path)
  const prefix = `${basename(path)}.tmp.`
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (caught: unknown) {
    if (
      typeof caught === 'object' &&
      caught !== null &&
      'code' in caught &&
      caught.code === 'ENOENT'
    ) {
      return
    }
    throw caught
  }
  const now = Date.now()
  for (const name of entries) {
    if (!name.startsWith(prefix)) {
      continue
    }
    const candidate = join(dir, name)
    try {
      const info = await stat(candidate)
      if (now - info.mtimeMs > TMP_SIBLING_TTL_MS) {
        await rm(candidate, { force: true })
      }
    } catch {
      // pw-allow-swallow: tempfile may vanish between readdir and stat;
      // a concurrent writer's cleanup is not a failure for our caller.
    }
  }
}
