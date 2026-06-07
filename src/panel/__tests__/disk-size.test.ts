import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diskSizeBytes } from '../disk-size.ts'

const isWindows = process.platform === 'win32'

describe.skipIf(isWindows)('diskSizeBytes — real du', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true })))
    tempDirs.length = 0
  })

  it('returns a positive byte count for a dir with a known file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pw-disk-size-'))
    tempDirs.push(dir)
    // 8 KiB of content guarantees du -sk reports at least one block.
    await writeFile(join(dir, 'payload.bin'), Buffer.alloc(8 * 1024, 1))

    const bytes = await diskSizeBytes(dir)

    expect(bytes).not.toBeNull()
    // Loose lower bound: real allocation rounds up to block size, so assert it
    // cleared a few KB rather than an exact total.
    expect(bytes).toBeGreaterThanOrEqual(4 * 1024)
  })
})

describe('diskSizeBytes — injected du', () => {
  it('parses the leading kilobytes and converts to bytes', async () => {
    const runDu = vi.fn(() => Promise.resolve('1234\t/some/worktree\n'))

    const bytes = await diskSizeBytes('/some/worktree', runDu)

    expect(bytes).toBe(1234 * 1024)
    expect(runDu).toHaveBeenCalledWith('/some/worktree')
  })

  it('handles space-separated du output', async () => {
    const runDu = vi.fn(() => Promise.resolve('  42 /space/sep\n'))

    await expect(diskSizeBytes('/space/sep', runDu)).resolves.toBe(42 * 1024)
  })

  it('returns null on unparseable output', async () => {
    const runDu = vi.fn(() => Promise.resolve('not-a-number\t/x\n'))

    await expect(diskSizeBytes('/x', runDu)).resolves.toBeNull()
  })

  it('returns null on empty output', async () => {
    const runDu = vi.fn(() => Promise.resolve(''))

    await expect(diskSizeBytes('/x', runDu)).resolves.toBeNull()
  })

  it('returns null (never throws) on a spawn error', async () => {
    const runDu = vi.fn(() => Promise.reject(new Error('spawn du ENOENT')))

    await expect(diskSizeBytes('/missing', runDu)).resolves.toBeNull()
  })
})

describe('diskSizeBytes — platform guard', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('returns null on win32 without invoking du', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const runDu = vi.fn(() => Promise.resolve('999\t/win\n'))

    await expect(diskSizeBytes('/win', runDu)).resolves.toBeNull()
    expect(runDu).not.toHaveBeenCalled()
  })
})
