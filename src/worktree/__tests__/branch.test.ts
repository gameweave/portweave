import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { worktreeBranch } from '../branch.ts'
import {
  addGitWorktree,
  createTempDir,
  createTempGitRepo,
  type TempGitRepo,
} from './_helpers.ts'

function gitRevParse(cwd: string, ref: string): string {
  const result = spawnSync('git', ['rev-parse', ref], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function gitCheckoutDetached(cwd: string, ref: string): void {
  const result = spawnSync('git', ['checkout', '--detach', ref], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`git checkout --detach failed: ${result.stderr.trim()}`)
  }
}

describe('worktreeBranch', () => {
  let repo: null | TempGitRepo = null

  afterEach(() => {
    if (repo) {
      repo.cleanup()
      repo = null
    }
  })

  it('returns the current branch name for a git repo', () => {
    repo = createTempGitRepo()
    expect(worktreeBranch(repo.root)).toBe('main')
  })

  it('returns the branch name for a linked worktree', () => {
    repo = createTempGitRepo()
    const worktreePath = `${repo.root}-feature`
    addGitWorktree(repo.root, 'feature/panel-branch-name', worktreePath)

    expect(worktreeBranch(worktreePath)).toBe('feature/panel-branch-name')
  })

  it('returns null for a detached HEAD', () => {
    repo = createTempGitRepo()
    const commit = gitRevParse(repo.root, 'HEAD')
    gitCheckoutDetached(repo.root, commit)

    expect(worktreeBranch(repo.root)).toBeNull()
  })

  it('returns null for a non-git directory', () => {
    const dir = createTempDir()
    try {
      expect(worktreeBranch(dir.path)).toBeNull()
    } finally {
      dir.cleanup()
    }
  })
})
