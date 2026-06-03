/**
 * Utilities for the exports smoke test. These helpers create a minimal
 * consumer project that installs portweave from a local pack file, then
 * verifies that `import { ports } from 'portweave/runtime'` resolves correctly.
 *
 * Kept as a named module so the structure:check tooling can pair it with
 * `exports-smoke.test.ts`.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const FIXTURE_CONSUMER_CONFIG = JSON.stringify({
  services: { api: { envVar: 'API_PORT' } },
})

export async function makeConsumerProject(
  consumerDir: string,
  packFile: string,
  typesNodeSpec: string,
): Promise<void> {
  // A realistic TypeScript Node consumer installs @types/node — the published
  // .d.ts references the global `NodeJS` namespace (e.g. ProcessEnv), as is
  // normal for a Node-targeted package. Pin it to the repo's version so the
  // type check mirrors the types the package was built against.
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      dependencies: { portweave: `file:${packFile}` },
      devDependencies: { '@types/node': typesNodeSpec },
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
  // Use mkdtemp to guarantee uniqueness; pid + Date.now() leaves a theoretical
  // collision window under concurrent runs.
  return mkdtemp(join(tmpdir(), `portweave-smoke-${label}-`))
}
