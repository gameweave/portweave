import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { withLock } from '../lock.ts'

let dir: string
let lockDir: string
const originalEnv = process.env.PORTWEAVE_LOCK_TIMEOUT_MS

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-lock-'))
  lockDir = join(dir, 'registry.lock')
})

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.PORTWEAVE_LOCK_TIMEOUT_MS
  } else {
    process.env.PORTWEAVE_LOCK_TIMEOUT_MS = originalEnv
  }
  await rm(dir, { force: true, recursive: true })
})

describe('withLock', () => {
  it('acquires, runs fn, and releases the lock on success', async () => {
    let observedLockedDuringFn = false
    const result = await withLock(lockDir, () => {
      observedLockedDuringFn = existsSync(lockDir)
      return Promise.resolve('value')
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('value')
    }
    expect(observedLockedDuringFn).toBe(true)
    expect(existsSync(lockDir)).toBe(false)
  })

  it('releases the lock when fn throws', async () => {
    let threw = false
    try {
      await withLock(lockDir, () => {
        throw new Error('boom')
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(existsSync(lockDir)).toBe(false)
  })

  it('reclaims a stale lock whose mtime is older than the TTL', async () => {
    await mkdir(lockDir)
    const past = new Date(Date.now() - 60_000)
    await utimes(lockDir, past, past)
    const result = await withLock(lockDir, () => Promise.resolve(42))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(42)
    }
  })

  it('returns PW0301 when retry budget is exhausted', async () => {
    process.env.PORTWEAVE_LOCK_TIMEOUT_MS = '50'
    await mkdir(lockDir)
    // Lock is fresh (just created), so stale recovery won't kick in.
    const result = await withLock(lockDir, () => Promise.resolve('never'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PW_ERROR_CODES.REGISTRY_LOCKED)
    }
    // The lock we placed manually is still there — assert we did not delete it.
    expect(existsSync(lockDir)).toBe(true)
    await rm(lockDir, { force: true, recursive: true })
  })

  it('honors PORTWEAVE_LOCK_TIMEOUT_MS by failing within roughly that window', async () => {
    process.env.PORTWEAVE_LOCK_TIMEOUT_MS = '100'
    await mkdir(lockDir)
    const start = Date.now()
    const result = await withLock(lockDir, () => Promise.resolve(0))
    const elapsed = Date.now() - start
    expect(result.ok).toBe(false)
    expect(elapsed).toBeLessThan(1500)
    await rm(lockDir, { force: true, recursive: true })
  })

  it('serializes back-to-back acquires from the same process', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstHeld = new Promise<void>((res) => {
      releaseFirst = res
    })
    const first = withLock(lockDir, async () => {
      order.push('first-start')
      await firstHeld
      order.push('first-end')
      return 1
    })
    // Give the first call time to acquire the lock before queuing the second.
    while (!order.includes('first-start')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    const second = withLock(lockDir, () => {
      order.push('second-run')
      return Promise.resolve(2)
    })
    await new Promise((r) => setTimeout(r, 50))
    releaseFirst?.()
    const [a, b] = await Promise.all([first, second])
    expect(a.ok && b.ok).toBe(true)
    expect(order).toStrictEqual(['first-start', 'first-end', 'second-run'])
  })

  it('ignores PORTWEAVE_LOCK_TIMEOUT_MS when it is not a positive integer', async () => {
    process.env.PORTWEAVE_LOCK_TIMEOUT_MS = 'banana'
    const result = await withLock(lockDir, () => Promise.resolve('ok'))
    expect(result.ok).toBe(true)
  })
})
