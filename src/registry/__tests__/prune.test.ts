import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneStaleEntries } from '../prune.ts'
import type { RegistryEntry } from '../types.ts'

const makeEntry = (worktreeRoot: string): RegistryEntry => ({
  key: {
    gitCommonDir: null,
    namespace: 'main',
    offsetOverride: null,
    worktreeRoot,
  },
  lastUsedAt: '2026-05-23T17:42:11.000Z',
  namespace: 'main',
  ports: { api: 30100 },
})

describe('pruneStaleEntries', () => {
  it('drops entries whose worktreeRoot is missing', () => {
    const present = new Set(['/exists'])
    const entries = [makeEntry('/exists'), makeEntry('/gone')]
    const pruned = pruneStaleEntries(entries, (p) => present.has(p))
    expect(pruned).toHaveLength(1)
    expect(pruned[0]?.key.worktreeRoot).toBe('/exists')
  })

  it('keeps every entry whose worktreeRoot exists', () => {
    const pruned = pruneStaleEntries(
      [makeEntry('/a'), makeEntry('/b')],
      () => true,
    )
    expect(pruned).toHaveLength(2)
  })

  it('does not touch the filesystem when given a stub predicate', () => {
    let calls = 0
    const pruned = pruneStaleEntries([makeEntry('/x')], () => {
      calls++
      return true
    })
    expect(calls).toBe(1)
    expect(pruned).toHaveLength(1)
  })

  it('returns an empty array for empty input', () => {
    expect(pruneStaleEntries([])).toStrictEqual([])
  })

  it('uses default existsSync predicate when none provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pw-prune-'))
    try {
      const real = makeEntry(dir)
      const fake = makeEntry(join(dir, 'definitely-not-here'))
      const pruned = pruneStaleEntries([real, fake])
      expect(pruned).toHaveLength(1)
      expect(pruned[0]?.key.worktreeRoot).toBe(dir)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })

  it('rejects entries whose worktreeRoot is a file, not a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pw-prune-'))
    const filePath = join(dir, 'not-a-dir')
    await writeFile(filePath, 'x', 'utf-8')
    try {
      const pruned = pruneStaleEntries([makeEntry(filePath)])
      expect(pruned).toHaveLength(0)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})
