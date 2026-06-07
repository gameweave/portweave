import type { PanelProject, PanelWorktree } from './types.ts'

function worktreeIsLive(worktree: PanelWorktree): boolean {
  return worktree.services.some((service) => service.status === 'live')
}

export function compareWorktrees(a: PanelWorktree, b: PanelWorktree): number {
  const aLive = worktreeIsLive(a)
  const bLive = worktreeIsLive(b)
  if (aLive !== bLive) {
    return aLive ? -1 : 1
  }
  const byLastUsed = b.lastUsedAt.localeCompare(a.lastUsedAt)
  if (byLastUsed !== 0) {
    return byLastUsed
  }
  return a.namespace.localeCompare(b.namespace)
}

// Projects sort by label; ties break on gitCommonDir string with null last.
export function compareProjects(a: PanelProject, b: PanelProject): number {
  const byLabel = a.label.localeCompare(b.label)
  if (byLabel !== 0) {
    return byLabel
  }
  if (a.gitCommonDir === b.gitCommonDir) {
    return 0
  }
  if (a.gitCommonDir === null) {
    return 1
  }
  if (b.gitCommonDir === null) {
    return -1
  }
  return a.gitCommonDir.localeCompare(b.gitCommonDir)
}
