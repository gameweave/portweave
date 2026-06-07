import { describe, expect, it } from 'vitest'
import type { PanelPrStatus, PrState } from '../types.ts'
import { deriveRemoveCommand, deriveSafeToPrune } from '../triage.ts'

const prStatus = (state: PrState): PanelPrStatus => ({
  number: 42,
  state,
  url: 'https://github.com/org/repo/pull/42',
})

describe('deriveSafeToPrune', () => {
  it('is true for a linked worktree with a merged PR and a clean tree', () => {
    expect(
      deriveSafeToPrune({
        kind: 'linked',
        prStatus: prStatus('merged'),
        workingTreeClean: true,
      }),
    ).toBe(true)
  })

  it('is true for a linked worktree with a closed PR and a clean tree', () => {
    expect(
      deriveSafeToPrune({
        kind: 'linked',
        prStatus: prStatus('closed'),
        workingTreeClean: true,
      }),
    ).toBe(true)
  })

  it('is false for the main checkout even when merged and clean', () => {
    expect(
      deriveSafeToPrune({
        kind: 'main',
        prStatus: prStatus('merged'),
        workingTreeClean: true,
      }),
    ).toBe(false)
  })

  it('is false for a linked worktree whose PR is still open', () => {
    expect(
      deriveSafeToPrune({
        kind: 'linked',
        prStatus: prStatus('open'),
        workingTreeClean: true,
      }),
    ).toBe(false)
  })

  it('is false for a linked worktree with a merged PR but a dirty tree', () => {
    expect(
      deriveSafeToPrune({
        kind: 'linked',
        prStatus: prStatus('merged'),
        workingTreeClean: false,
      }),
    ).toBe(false)
  })

  it('is false when the clean state is unknown (null treated as not clean)', () => {
    expect(
      deriveSafeToPrune({
        kind: 'linked',
        prStatus: prStatus('merged'),
        workingTreeClean: null,
      }),
    ).toBe(false)
  })

  it('is false when the PR is unknown (null)', () => {
    expect(
      deriveSafeToPrune({
        kind: 'linked',
        prStatus: null,
        workingTreeClean: true,
      }),
    ).toBe(false)
  })
})

describe('deriveRemoveCommand', () => {
  it('emits the safe (non-force) form for a plain path', () => {
    expect(deriveRemoveCommand('/home/dev/project')).toBe(
      "git worktree remove '/home/dev/project'",
    )
  })

  it('single-quotes a path containing a space', () => {
    expect(deriveRemoveCommand('/home/dev/my project')).toBe(
      "git worktree remove '/home/dev/my project'",
    )
  })

  it("escapes an embedded single quote as '\\''", () => {
    expect(deriveRemoveCommand("/home/dev/o'brien")).toBe(
      "git worktree remove '/home/dev/o'\\''brien'",
    )
  })
})
