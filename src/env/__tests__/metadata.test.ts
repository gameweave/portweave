import { describe, expect, it } from 'vitest'
import type { Allocation } from '../../allocator/allocate.ts'
import { buildMetadata, PW_METADATA_FIELDS } from '../metadata.ts'

const baseAllocation: Allocation = {
  key: {
    gitCommonDir: '/repo/.git',
    namespace: 'feature-x-7a2b91',
    offsetOverride: null,
    worktreeRoot: '/repo/wt/feature-x',
  },
  lastUsedAt: '2026-05-26T00:00:00.000Z',
  namespace: 'feature-x-7a2b91',
  ports: { api: 30100 },
}

describe('buildMetadata', () => {
  it('maps namespace, worktreeRoot, and gitCommonDir from the allocation', () => {
    expect(buildMetadata(baseAllocation)).toEqual({
      gitCommonDir: '/repo/.git',
      namespace: 'feature-x-7a2b91',
      worktreeRoot: '/repo/wt/feature-x',
    })
  })

  it('resolves gitCommonDir to empty string when null (non-git)', () => {
    const meta = buildMetadata({
      ...baseAllocation,
      key: { ...baseAllocation.key, gitCommonDir: null },
    })
    expect(meta.gitCommonDir).toBe('')
  })

  it('exposes exactly the three identity fields', () => {
    expect([...PW_METADATA_FIELDS]).toEqual([
      'gitCommonDir',
      'namespace',
      'worktreeRoot',
    ])
  })
})
