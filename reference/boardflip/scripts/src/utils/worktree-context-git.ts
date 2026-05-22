import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'

export interface GitWorktreeContext {
  currentRoot: string
  gitCommonDir: string
  mainRoot: string
  worktreeRoots: string[]
}

export function gitEnvForCwd(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
  ] as const) {
    Reflect.deleteProperty(env, key)
  }
  return env
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

export function normalizePath(path: string): string {
  return resolve(path)
}

export function resolveGitPath(currentRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(currentRoot, path)
}

export function parseWorktreeRoots(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => normalizePath(line.slice('worktree '.length)))
}

export function detectGitWorktreeContext(
  cwd: string,
): GitWorktreeContext | null {
  const currentRoot = runGit(['rev-parse', '--show-toplevel'], cwd)
  const gitCommonDir = runGit(['rev-parse', '--git-common-dir'], cwd)
  const worktreeOutput = runGit(['worktree', 'list', '--porcelain'], cwd)

  if (!currentRoot || !gitCommonDir || !worktreeOutput) {
    return null
  }

  const worktreeRoots = parseWorktreeRoots(worktreeOutput)
  const mainRoot = worktreeRoots[0] ?? currentRoot

  return {
    currentRoot: normalizePath(currentRoot),
    gitCommonDir: resolveGitPath(currentRoot, gitCommonDir),
    mainRoot: normalizePath(mainRoot),
    worktreeRoots,
  }
}
