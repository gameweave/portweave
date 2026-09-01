// Helper invoked via child_process.fork from allocate.concurrent.test.ts.
// Each subprocess calls allocate() with a distinct AllocationKey and a
// 2-service config, then writes the allocated ports to stdout as JSON and
// exits 0 on success or with a non-zero code on failure.

import { allocate } from '../../allocate.ts'
import type { Config } from '../../../config/index.ts'

async function main(): Promise<void> {
  const xdgConfigHome = process.env.PW_TEST_XDG ?? ''
  const worktreeRoot = process.env.PW_TEST_ROOT ?? ''
  const namespace = process.env.PW_TEST_NAMESPACE ?? ''
  if (xdgConfigHome === '' || worktreeRoot === '' || namespace === '') {
    process.stderr.write('missing env\n')
    process.exit(2)
  }

  const key = {
    gitCommonDir: process.env.PW_TEST_GIT_COMMON ?? null,
    namespace,
    offsetOverride: null,
    worktreeRoot,
  }

  const config: Config = {
    envAuthority: 'dotenv',
    groups: {},
    services: [
      { discoveryEnv: {}, envVar: 'API_PORT', name: 'api' },
      { discoveryEnv: {}, envVar: 'VITE_PORT', name: 'vite' },
    ],
    source: 'anonymous',
  }

  const allocEnv: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: xdgConfigHome }
  if (process.env.PORTWEAVE_POOL_RANGE !== undefined) {
    allocEnv.PORTWEAVE_POOL_RANGE = process.env.PORTWEAVE_POOL_RANGE
  }
  const result = await allocate(key, config, allocEnv)
  if (!result.ok) {
    process.stderr.write(
      `allocate failed: ${result.error.code} ${result.error.message}\n`,
    )
    process.exit(3)
  }
  process.stdout.write(JSON.stringify(result.value.allocation.ports))
  process.exit(0)
}

main().catch((caught: unknown) => {
  const message = caught instanceof Error ? caught.message : 'unknown error'
  process.stderr.write(`crash: ${message}\n`)
  process.exit(1)
})
