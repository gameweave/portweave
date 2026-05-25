import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../error-passthrough.ts'
import { ports } from '../index.ts'

async function makeTmpDir(label: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `portweave-errpass-test-${label}-${process.pid.toString()}-${Date.now().toString()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}

describe('PW0101 — CONFIG_MISSING passthrough', () => {
  it('returns PW0101 when explicit configPath points at a nonexistent file', async () => {
    const dir = await makeTmpDir('pw0101')
    const result = await ports({
      configPath: 'totally-missing.json',
      cwd: dir,
    })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_MISSING)
    expect(result.error.message).toBeTruthy()
  })
})

describe('PW0202 — WORKTREE_OFFSET_INVALID passthrough', () => {
  let savedOffset: string | undefined

  beforeEach(() => {
    savedOffset = process.env.PORTWEAVE_OFFSET
  })

  afterEach(() => {
    if (savedOffset === undefined) {
      delete process.env.PORTWEAVE_OFFSET
    } else {
      process.env.PORTWEAVE_OFFSET = savedOffset
    }
  })

  it('returns PW0202 when PORTWEAVE_OFFSET is not a number', async () => {
    process.env.PORTWEAVE_OFFSET = 'not-a-number'
    const dir = await makeTmpDir('pw0202')
    await writeFile(
      join(dir, 'portweave.config.json'),
      JSON.stringify({ services: { svc: { envVar: 'SVC_PORT' } } }),
    )
    const result = await ports({ cwd: dir })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.WORKTREE_OFFSET_INVALID)
  })
})

describe('PW0401 — ALLOCATION_EXHAUSTED passthrough', () => {
  let savedRange: string | undefined

  beforeEach(() => {
    savedRange = process.env.PORTWEAVE_POOL_RANGE
  })

  afterEach(() => {
    if (savedRange === undefined) {
      delete process.env.PORTWEAVE_POOL_RANGE
    } else {
      process.env.PORTWEAVE_POOL_RANGE = savedRange
    }
  })

  it('returns PW0401 when pool range is too small for the requested services', async () => {
    // Use a range of exactly 1 port but config has 3 services — forces exhaustion
    process.env.PORTWEAVE_POOL_RANGE = '40000-40001'
    const dir = await makeTmpDir('pw0401')
    await writeFile(
      join(dir, 'portweave.config.json'),
      JSON.stringify({
        services: {
          a: { envVar: 'A_PORT' },
          b: { envVar: 'B_PORT' },
          c: { envVar: 'C_PORT' },
        },
      }),
    )
    const result = await ports({ cwd: dir })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.ALLOCATION_EXHAUSTED)
  })
})
