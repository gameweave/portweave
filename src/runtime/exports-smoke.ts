/**
 * Utilities for the exports smoke test. These helpers create a minimal
 * consumer project that installs portweave from a local pack file, then
 * verifies that `import { ports } from 'portweave/runtime'` resolves correctly.
 *
 * Kept as a named module so the structure:check tooling can pair it with
 * `exports-smoke.test.ts`.
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const FIXTURE_CONSUMER_CONFIG = JSON.stringify({
  services: { api: { envVar: 'API_PORT' } },
})

export async function makeConsumerProject(
  consumerDir: string,
  packFile: string,
): Promise<void> {
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      dependencies: { portweave: `file:${packFile}` },
      name: 'smoke-consumer',
      type: 'module',
      version: '0.0.0',
    }),
  )
  await execFileAsync('npm', ['install', '--prefer-offline', '--no-audit'], {
    cwd: consumerDir,
    env: { ...process.env, NODE_ENV: 'test' },
  })
  await writeFile(
    join(consumerDir, 'portweave.config.json'),
    FIXTURE_CONSUMER_CONFIG,
  )
}

export async function makeTmpSmokeDir(label: string): Promise<string> {
  const { tmpdir } = await import('node:os')
  const dir = join(
    tmpdir(),
    `portweave-smoke-${label}-${process.pid.toString()}-${Date.now().toString()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}
