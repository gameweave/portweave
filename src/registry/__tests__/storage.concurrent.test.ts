import { fork } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONCURRENT_WRITER_COUNT,
  CONCURRENT_WRITER_PATH,
} from '../storage.concurrent.ts'
import type { RegistryEntry } from '../types.ts'

const _require = createRequire(import.meta.url)
const TSX_PATH: string = _require.resolve('tsx/cli')

let configDir: string
let workerRoots: string[] = []

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-concurrent-'))
  workerRoots = []
  for (let i = 0; i < CONCURRENT_WRITER_COUNT; i++) {
    const root = await mkdtemp(
      join(tmpdir(), `pw-concurrent-wt-${i.toString()}-`),
    )
    workerRoots.push(root)
  }
})

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true })
  for (const root of workerRoots) {
    await rm(root, { force: true, recursive: true })
  }
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
        PW_TEST_XDG: configDir,
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
      workerRoots.map((root, i) => spawnWorker(root, 30100 + i)),
    )
    for (const r of results) {
      expect(r.code, `worker failed: ${r.stderr}`).toBe(0)
    }
    const registryFile = join(configDir, 'portweave', 'registry.json')
    const text = await readFile(registryFile, 'utf-8')
    const parsed = JSON.parse(text) as { entries: RegistryEntry[] }
    expect(parsed.entries).toHaveLength(CONCURRENT_WRITER_COUNT)
    const observedRoots = parsed.entries.map((e) => e.key.worktreeRoot)
    const uniqueRoots = new Set(observedRoots)
    expect(uniqueRoots.size).toBe(CONCURRENT_WRITER_COUNT)
    for (const root of workerRoots) {
      expect(uniqueRoots.has(root)).toBe(true)
    }
  }, 30_000)
})
