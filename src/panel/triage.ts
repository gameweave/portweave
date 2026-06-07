import type { PanelPrStatus, WorktreeKind } from './types.ts'

/**
 * Safe-to-prune is conservative by construction (B-3): only a linked worktree
 * whose PR is merged/closed and whose tree is clean. The main checkout is never
 * safe, a PR-unknown (null) worktree is never safe — you cannot assert "done"
 * without the PR signal — and an unknown clean state (null) counts as not clean.
 */
export function deriveSafeToPrune(input: {
  readonly kind: WorktreeKind
  readonly prStatus: null | PanelPrStatus
  readonly workingTreeClean: boolean | null
}): boolean {
  const prResolved =
    input.prStatus?.state === 'merged' || input.prStatus?.state === 'closed'

  return (
    input.kind === 'linked' && prResolved && input.workingTreeClean === true
  )
}

/**
 * Copyable `git worktree remove <root>` in the safe (non-force) form. The path
 * is POSIX-single-quoted so a worktree path with spaces copies correctly; an
 * embedded single quote is escaped as `'\''` (close, escaped quote, reopen).
 */
export function deriveRemoveCommand(worktreeRoot: string): string {
  const quoted = `'${worktreeRoot.replaceAll("'", "'\\''")}'`

  return `git worktree remove ${quoted}`
}
