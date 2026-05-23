import { resolve } from 'node:path'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { detectGitWorktreeContext } from './git.ts'
import {
  deriveNamespace,
  namespaceOverride,
  parseExplicitOffset,
} from './namespace.ts'

export interface AllocationKey {
  gitCommonDir: null | string
  namespace: string
  offsetOverride: null | number
  worktreeRoot: string
}

export function resolveAllocationKey(
  cwd: string,
): Result<AllocationKey, PortweaveError> {
  const absoluteCwd = resolve(cwd)
  const gitResult = detectGitWorktreeContext(absoluteCwd)

  let worktreeRoot: string
  let gitCommonDir: null | string
  let derived: string

  if (gitResult.ok) {
    worktreeRoot = gitResult.value.currentRoot
    gitCommonDir = gitResult.value.gitCommonDir
    derived = deriveNamespace(
      gitResult.value.currentRoot,
      gitResult.value.mainRoot,
    )
  } else if (gitResult.error.code === PW_ERROR_CODES.NOT_A_GIT_REPO) {
    worktreeRoot = absoluteCwd
    gitCommonDir = null
    derived = deriveNamespace(absoluteCwd, absoluteCwd)
  } else {
    return err(gitResult.error)
  }

  const override = namespaceOverride()
  const namespace = override ?? derived

  const offsetResult = parseExplicitOffset()
  if (!offsetResult.ok) {
    return err(offsetResult.error)
  }

  return ok({
    gitCommonDir,
    namespace,
    offsetOverride: offsetResult.value,
    worktreeRoot,
  })
}
