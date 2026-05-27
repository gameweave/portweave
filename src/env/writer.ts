import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const NEEDS_QUOTING = /[\s#$"'\\]/

function shouldQuote(value: string): boolean {
  return NEEDS_QUOTING.test(value)
}

function quoteValue(value: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `"${escaped}"`
}

export function serializeDotenv(env: Readonly<Record<string, string>>): string {
  const keys = Object.keys(env).sort()
  if (keys.length === 0) {
    return ''
  }
  return (
    keys
      .map((key) => {
        const value = env[key]
        const serializedValue = shouldQuote(value) ? quoteValue(value) : value
        return `${key}=${serializedValue}`
      })
      .join('\n') + '\n'
  )
}

export async function ensurePortweaveDir(
  projectRoot: string,
): Promise<{ created: boolean }> {
  const portweaveDir = join(projectRoot, '.portweave')
  const gitignorePath = join(portweaveDir, '.gitignore')

  // Try to access the directory to check if it already exists
  let dirAlreadyExisted = true
  try {
    await access(portweaveDir)
  } catch {
    // pw-allow-swallow: access throws ENOENT when dir is absent; we handle
    // the "did not exist" case below by setting the flag.
    dirAlreadyExisted = false
  }

  await mkdir(portweaveDir, { mode: 0o700, recursive: true })

  if (!dirAlreadyExisted) {
    // First creation — write the .gitignore
    await writeFile(gitignorePath, '*\n', { encoding: 'utf-8', flag: 'wx' })
    return { created: true }
  }

  // Directory already existed — ensure .gitignore exists but don't overwrite
  try {
    await access(gitignorePath)
    // .gitignore already present — nothing to do
  } catch {
    // pw-allow-swallow: .gitignore absent even though dir existed (e.g. user
    // deleted it manually). Write it now using 'wx' so a concurrent writer
    // doesn't clobber an existing file.
    try {
      await writeFile(gitignorePath, '*\n', { encoding: 'utf-8', flag: 'wx' })
    } catch {
      // pw-allow-swallow: concurrent writer may have created it between our
      // access check and writeFile — that outcome is fine for our purposes.
    }
  }

  return { created: false }
}

export async function atomicWriteDotenv(
  path: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const tempPath = `${path}.tmp.${process.pid.toString()}.${Date.now().toString()}`
  const contents = serializeDotenv(env)
  await writeFile(tempPath, contents, { encoding: 'utf-8', mode: 0o600 })
  await rename(tempPath, path)
}
