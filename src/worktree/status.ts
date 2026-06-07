import { spawnSync } from 'node:child_process'
import { gitEnvForCwd } from './git.ts'

// Cannot reuse runGit from git.ts: it collapses empty-stdout-exit-0 to null,
// but a CLEAN tree's `git status --porcelain` is exactly that — so runGit would
// conflate "clean" with "git failed." We inspect the exit status explicitly.
export function worktreeIsClean(worktreeRoot: string): boolean | null {
  try {
    const result = spawnSync('git', ['status', '--porcelain'], {
      cwd: worktreeRoot,
      encoding: 'utf-8',
      env: gitEnvForCwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status !== 0) {
      return null
    }

    return result.stdout.trim() === ''
  } catch {
    // pw-allow-swallow: spawn failure (e.g. git missing) is an unknown tree state
    return null
  }
}
