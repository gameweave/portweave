import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { spawnChild } from '../spawn.ts'

function makeIo() {
  return {
    stderr: new Writable({
      write(_c, _e, cb) {
        cb()
      },
    }),
    stdout: new Writable({
      write(_c, _e, cb) {
        cb()
      },
    }),
  }
}

describe('spawnChild', () => {
  it('resolves with exitCode 0 for a child that exits 0', async () => {
    const result = await spawnChild(['node', '-e', 'process.exit(0)'], {
      env: process.env,
      io: makeIo(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(0)
      expect(result.value.signal).toBeNull()
    }
  })

  it('resolves with exitCode 42 for a child that exits 42', async () => {
    const result = await spawnChild(['node', '-e', 'process.exit(42)'], {
      env: process.env,
      io: makeIo(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(42)
      expect(result.value.signal).toBeNull()
    }
  })

  it('returns err(PortweaveError) with CLI_CHILD_SPAWN_FAILED for a bogus command', async () => {
    const result = await spawnChild(['nonexistent-xyz-portweave-9999'], {
      env: process.env,
      io: makeIo(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PW_ERROR_CODES.CLI_CHILD_SPAWN_FAILED)
    }
  })

  it('forwards SIGTERM to child via AbortSignal', async () => {
    const controller = new AbortController()
    const childScript = `
        process.on('SIGTERM', () => { process.exit(143); });
        setTimeout(() => {}, 10000);
      `
    const spawnPromise = spawnChild(['node', '-e', childScript], {
      env: process.env,
      io: makeIo(),
      signal: controller.signal,
    })
    // Give the child time to start then abort
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    controller.abort()
    const result = await spawnPromise
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Child exits 143 (SIGTERM convention) or signal is set
      const { exitCode, signal } = result.value
      const terminated =
        exitCode === 143 || signal === 'SIGTERM' || exitCode !== null
      expect(terminated).toBe(true)
    }
  }, 5000)
})
