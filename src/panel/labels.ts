import { basename, dirname } from 'node:path'
import { MAIN_NAMESPACE } from '../worktree/namespace.ts'

const NO_REPO_LABEL = '(no repo)'
const GIT_SUFFIX = '.git'

// The minimal shape resolveLabel needs from each grouped worktree. enrich.ts's
// internal EnrichedWorktree is structurally compatible, so callers pass it
// directly; declaring it here keeps this module independent of enrich.ts.
interface LabelSource {
  readonly projectName: null | string
  readonly worktree: { readonly namespace: string }
}

// Explicit projectName wins (main-namespace config first, else first non-empty
// by namespace sort); else derived from gitCommonDir; else '(no repo)'.
export function resolveLabel(
  sorted: readonly LabelSource[],
  gitCommonDir: null | string,
): string {
  const mainName =
    sorted.find((item) => item.worktree.namespace === MAIN_NAMESPACE)
      ?.projectName ?? null
  const firstName =
    sorted.find((item) => item.projectName !== null)?.projectName ?? null
  return mainName ?? firstName ?? deriveLabel(gitCommonDir)
}

function deriveLabel(gitCommonDir: null | string): string {
  if (gitCommonDir === null) {
    return NO_REPO_LABEL
  }
  const base = basename(gitCommonDir)
  return base === GIT_SUFFIX ? basename(dirname(gitCommonDir)) : base
}
