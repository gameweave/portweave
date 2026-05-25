import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TempGitRepo {
  cleanup: () => void
  root: string
}

export function createTempGitRepo(prefix = 'portweave-worktree-'): TempGitRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  // requires git >= 2.28 for --initial-branch flag
  runGit(['init', '--initial-branch=main', root], root)
  runGit(['config', 'user.email', 'test@portweave.local'], root)
  runGit(['config', 'user.name', 'Portweave Test'], root)
  runGit(['commit', '--allow-empty', '-m', 'init'], root)

  return {
    cleanup: () => {
      rmSync(root, { force: true, recursive: true })
    },
    root,
  }
}

export function addGitWorktree(
  repoRoot: string,
  branchName: string,
  worktreePath: string,
): void {
  runGit(['worktree', 'add', worktreePath, '-b', branchName], repoRoot)
}

export function createTempDir(prefix = 'portweave-nogit-'): {
  cleanup: () => void
  path: string
} {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  return {
    cleanup: () => {
      rmSync(path, { force: true, recursive: true })
    },
    path,
  }
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: status=${String(result.status)} stderr=${stderr}`,
    )
  }
}
