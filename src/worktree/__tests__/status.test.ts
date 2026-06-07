import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { worktreeIsClean } from '../status.ts'
import {
  createTempDir,
  createTempGitRepo,
  type TempGitRepo,
} from './_helpers.ts'

function gitAdd(cwd: string, pathspec: string): void {
  const result = spawnSync('git', ['add', pathspec], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`git add failed: ${result.stderr.trim()}`)
  }
}

describe('worktreeIsClean', () => {
  let repo: null | TempGitRepo = null

  afterEach(() => {
    if (repo) {
      repo.cleanup()
      repo = null
    }
  })

  it('returns true for a freshly initialized repo with no changes', () => {
    repo = createTempGitRepo()
    expect(worktreeIsClean(repo.root)).toBe(true)
  })

  it('returns false when an untracked file is present', () => {
    repo = createTempGitRepo()
    writeFileSync(join(repo.root, 'untracked.txt'), 'hello\n')

    expect(worktreeIsClean(repo.root)).toBe(false)
  })

  it('returns false when a change is staged', () => {
    repo = createTempGitRepo()
    writeFileSync(join(repo.root, 'staged.txt'), 'staged content\n')
    gitAdd(repo.root, 'staged.txt')

    expect(worktreeIsClean(repo.root)).toBe(false)
  })

  it('returns null for a non-git directory (clean-vs-failure distinction)', () => {
    const dir = createTempDir()
    try {
      expect(worktreeIsClean(dir.path)).toBeNull()
    } finally {
      dir.cleanup()
    }
  })
})
