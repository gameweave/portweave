import { fork } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONCURRENT_WRITER_COUNT,
  CONCURRENT_WRITER_PATH,
} from '../storage.concurrent.ts'
import type { RegistryEntry } from '../types.ts'
import {
  cleanupConcurrentDirs,
  type ConcurrentTestDirs,
  makeConcurrentDirs,
  TSX_PATH,
} from '../../__tests__/_concurrent-helpers.ts'

let dirs: ConcurrentTestDirs

beforeEach(async () => {
  dirs = await makeConcurrentDirs(
    'pw-concurrent-',
    'pw-concurrent-wt-',
    CONCURRENT_WRITER_COUNT,
  )
})

afterEach(async () => {
  await cleanupConcurrentDirs(dirs)
})

function spawnWorker(
  worktreeRoot: string,
  port: number,
): Promise<{ code: null | number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = fork(CONCURRENT_WRITER_PATH, [], {
      env: {
        ...process.env,
        PW_TEST_PORT: port.toString(),
        PW_TEST_ROOT: worktreeRoot,
        PW_TEST_XDG: dirs.configDir,
      },
      execArgv: ['--import', TSX_PATH],
      silent: true,
    })
    const stderr: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve({ code, stderr: Buffer.concat(stderr).toString('utf-8') })
    })
  })
}

describe('concurrent writers serialize through the registry lock', () => {
  it('each of 8 real subprocesses appends exactly one distinct entry with no torn writes', async () => {
    const results = await Promise.all(
      dirs.workerRoots.map((root, i) => spawnWorker(root, 30100 + i)),
    )
    for (const r of results) {
      expect(r.code, `worker failed: ${r.stderr}`).toBe(0)
    }
    const registryFile = join(dirs.configDir, 'portweave', 'registry.json')
    const text = await readFile(registryFile, 'utf-8')
    const parsed = JSON.parse(text) as { entries: RegistryEntry[] }
    expect(parsed.entries).toHaveLength(CONCURRENT_WRITER_COUNT)
    const observedRoots = parsed.entries.map((e) => e.key.worktreeRoot)
    const uniqueRoots = new Set(observedRoots)
    expect(uniqueRoots.size).toBe(CONCURRENT_WRITER_COUNT)
    for (const root of dirs.workerRoots) {
      expect(uniqueRoots.has(root)).toBe(true)
    }
  }, 30_000)
})
