import { spawnSync } from 'node:child_process'
import { gitEnvForCwd } from './git.ts'

// Cannot reuse runGit from git.ts: it collapses empty-stdout-exit-0 to null,
// but a detached HEAD's `git symbolic-ref --quiet --short HEAD` is exactly
// that — so runGit would conflate "detached" with "git failed." We inspect the
// exit status explicitly.
export function worktreeBranch(worktreeRoot: string): null | string {
  try {
    const result = spawnSync(
      'git',
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      {
        cwd: worktreeRoot,
        encoding: 'utf-8',
        env: gitEnvForCwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    if (result.status !== 0) {
      return null
    }

    const branch = result.stdout.trim()
    return branch === '' ? null : branch
  } catch {
    // pw-allow-swallow: spawn failure (e.g. git missing) is an unknown branch
    return null
  }
}
