// Helper invoked via child_process.fork from storage.concurrent.test.ts.
// Each subprocess acquires withRegistry, upserts one entry with a unique
// worktreeRoot, then exits 0 on success or with a non-zero code on failure.

import { withRegistry } from '../../storage.ts'
import type { RegistryEntry } from '../../types.ts'

async function main(): Promise<void> {
  const xdgConfigHome = process.env.PW_TEST_XDG ?? ''
  const worktreeRoot = process.env.PW_TEST_ROOT ?? ''
  const port = Number.parseInt(process.env.PW_TEST_PORT ?? '0', 10)
  if (xdgConfigHome === '' || worktreeRoot === '' || port === 0) {
    process.stderr.write('missing env\n')
    process.exit(2)
  }
  const entry: RegistryEntry = {
    key: {
      gitCommonDir: null,
      namespace: 'main',
      offsetOverride: null,
      worktreeRoot,
    },
    lastUsedAt: new Date().toISOString(),
    namespace: 'main',
    ports: { api: port },
  }
  const result = await withRegistry(
    (handle) => {
      handle.upsert(entry)
    },
    { XDG_CONFIG_HOME: xdgConfigHome },
  )
  if (!result.ok) {
    process.stderr.write(`withRegistry failed: ${result.error.code}\n`)
    process.exit(3)
  }
  process.exit(0)
}

main().catch((caught: unknown) => {
  const message = caught instanceof Error ? caught.message : 'unknown error'
  process.stderr.write(`crash: ${message}\n`)
  process.exit(1)
})
