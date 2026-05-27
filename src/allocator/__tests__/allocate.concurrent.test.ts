import { fork } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONCURRENT_ALLOCATOR_COUNT,
  CONCURRENT_ALLOCATOR_PATH,
} from '../allocate.concurrent.ts'
import {
  cleanupConcurrentDirs,
  type ConcurrentTestDirs,
  makeConcurrentDirs,
  TSX_PATH,
} from '../../__tests__/_concurrent-helpers.ts'

let dirs: ConcurrentTestDirs

beforeEach(async () => {
  dirs = await makeConcurrentDirs(
    'pw-concurrent-alloc-',
    'pw-conc-wt-',
    CONCURRENT_ALLOCATOR_COUNT,
  )
})

afterEach(async () => {
  await cleanupConcurrentDirs(dirs)
})

// Use a dedicated sub-range to keep the test isolated and make assertions tighter
const POOL_RANGE = '31000-32000'
const POOL_START = 31000
const POOL_END = 32000

function spawnWorker(
  worktreeRoot: string,
  namespace: string,
  gitCommonDir: string,
): Promise<{
  code: null | number
  ports: null | Record<string, number>
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    const child = fork(CONCURRENT_ALLOCATOR_PATH, [], {
      env: {
        ...process.env,
        PORTWEAVE_POOL_RANGE: POOL_RANGE,
        PW_TEST_GIT_COMMON: gitCommonDir,
        PW_TEST_NAMESPACE: namespace,
        PW_TEST_ROOT: worktreeRoot,
        PW_TEST_XDG: dirs.configDir,
      },
      execArgv: ['--import', TSX_PATH],
      silent: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('exit', (code) => {
      const stdoutStr = Buffer.concat(stdout).toString('utf-8').trim()
      let ports: null | Record<string, number> = null
      if (stdoutStr.length > 0) {
        try {
          ports = JSON.parse(stdoutStr) as Record<string, number>
        } catch {
          // pw-allow-swallow: stdout wasn't valid JSON — leave ports null
        }
      }
      resolve({
        code,
        ports,
        stderr: Buffer.concat(stderr).toString('utf-8'),
      })
    })
  })
}

describe('concurrent allocation correctness', () => {
  it(`${CONCURRENT_ALLOCATOR_COUNT.toString()} real subprocesses produce non-overlapping contiguous allocations`, async () => {
    const commonDir = join(dirs.configDir, 'fake-repo.git')
    const results = await Promise.all(
      dirs.workerRoots.map((root, i) =>
        spawnWorker(root, `wt-${i.toString()}`, commonDir),
      ),
    )

    for (const r of results) {
      expect(r.code, `worker failed: ${r.stderr}`).toBe(0)
      expect(r.ports, `worker produced no ports: ${r.stderr}`).not.toBeNull()
    }

    // Collect all allocated ports across all workers
    const allPorts: number[] = []
    for (const r of results) {
      if (r.ports === null) {
        continue
      }
      const ports = Object.values(r.ports)
      allPorts.push(...ports)
      // Each allocation must be contiguous
      const sorted = [...ports].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) {
        expect(
          sorted[i],
          'ports within one allocation must be contiguous',
        ).toBe(sorted[i - 1] + 1)
      }
      // All ports within pool range
      for (const port of ports) {
        expect(port, 'port must be >= pool start').toBeGreaterThanOrEqual(
          POOL_START,
        )
        expect(port, 'port must be < pool end').toBeLessThan(POOL_END)
      }
    }

    // No duplicate port across any worker
    const portSet = new Set(allPorts)
    expect(portSet.size, 'all ports across workers must be unique').toBe(
      allPorts.length,
    )
  }, 60_000)
})
