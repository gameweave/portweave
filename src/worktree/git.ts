import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'

export interface GitWorktreeContext {
  currentRoot: string
  gitCommonDir: string
  mainRoot: string
  worktreeRoots: string[]
}

const GIT_PASSTHROUGH_KEYS_TO_STRIP = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
] as const

const WORKTREE_LINE_PREFIX = 'worktree '

export function gitEnvForCwd(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of GIT_PASSTHROUGH_KEYS_TO_STRIP) {
    Reflect.deleteProperty(env, key)
  }
  return env
}

export function normalizePath(path: string): string {
  return resolve(path)
}

export function parseWorktreeRoots(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(WORKTREE_LINE_PREFIX))
    .map((line) => normalizePath(line.slice(WORKTREE_LINE_PREFIX.length)))
}

export function detectGitWorktreeContext(
  cwd: string,
): Result<GitWorktreeContext, PortweaveError> {
  const currentRoot = runGit(['rev-parse', '--show-toplevel'], cwd)
  const gitCommonDir = runGit(['rev-parse', '--git-common-dir'], cwd)
  const worktreeOutput = runGit(['worktree', 'list', '--porcelain'], cwd)

  if (
    currentRoot === null ||
    gitCommonDir === null ||
    worktreeOutput === null
  ) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.NOT_A_GIT_REPO,
        `not a git repository (cwd=${cwd})`,
      ),
    )
  }

  const worktreeRoots = parseWorktreeRoots(worktreeOutput)
  const mainRoot = worktreeRoots[0] ?? currentRoot

  return ok({
    currentRoot: normalizePath(currentRoot),
    gitCommonDir: resolveGitPath(currentRoot, gitCommonDir),
    mainRoot: normalizePath(mainRoot),
    worktreeRoots,
  })
}

function resolveGitPath(currentRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(currentRoot, path)
}

function runGit(args: string[], cwd: string): null | string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: gitEnvForCwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.status !== 0 || result.stdout.length === 0) {
    return null
  }

  return result.stdout.trim()
}
