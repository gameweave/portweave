import { describe, expect, it } from 'vitest'
import { compareProjects, compareWorktrees } from '../sort.ts'
import type { PanelProject, PanelWorktree } from '../types.ts'

function worktree(
  overrides: Partial<PanelWorktree> & Pick<PanelWorktree, 'namespace'>,
): PanelWorktree {
  return {
    branch: null,
    degraded: false,
    degradedReason: null,
    diskSizeBytes: null,
    kind: 'linked',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    prStatus: null,
    removeCommand: 'git worktree remove /tmp/wt',
    safeToPrune: false,
    services: [],
    workingTreeClean: null,
    worktreeRoot: `/tmp/${overrides.namespace}`,
    ...overrides,
  }
}

describe('compareWorktrees', () => {
  it('ranks live worktrees before not-running ones', () => {
    const live = worktree({
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      namespace: 'old-live',
      services: [
        {
          envVar: 'API_PORT',
          links: [],
          name: 'api',
          port: 3100,
          status: 'live',
        },
      ],
    })
    const recent = worktree({
      lastUsedAt: '2026-06-01T00:00:00.000Z',
      namespace: 'recent',
    })

    expect(compareWorktrees(live, recent)).toBeLessThan(0)
    expect(compareWorktrees(recent, live)).toBeGreaterThan(0)
  })

  it('ranks by lastUsedAt descending when liveness matches', () => {
    const recent = worktree({
      lastUsedAt: '2026-06-01T00:00:00.000Z',
      namespace: 'recent',
    })
    const old = worktree({
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      namespace: 'old',
    })

    expect(compareWorktrees(recent, old)).toBeLessThan(0)
  })

  it('falls back to namespace when liveness and lastUsedAt match', () => {
    const a = worktree({ namespace: 'feature-a' })
    const b = worktree({ namespace: 'feature-b' })

    expect(compareWorktrees(a, b)).toBeLessThan(0)
  })
})

describe('compareProjects', () => {
  it('sorts by label and breaks ties on gitCommonDir with null last', () => {
    const alpha: PanelProject = {
      gitCommonDir: '/repos/a/.git',
      label: 'alpha',
      worktrees: [],
    }
    const beta: PanelProject = {
      gitCommonDir: '/repos/b/.git',
      label: 'beta',
      worktrees: [],
    }
    const noRepo: PanelProject = {
      gitCommonDir: null,
      label: 'alpha',
      worktrees: [],
    }

    expect(compareProjects(alpha, beta)).toBeLessThan(0)
    expect(compareProjects(alpha, noRepo)).toBeLessThan(0)
  })
})
