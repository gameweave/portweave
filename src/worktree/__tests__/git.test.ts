import { rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import {
  detectGitWorktreeContext,
  gitEnvForCwd,
  normalizePath,
  parseWorktreeRoots,
} from '../git.ts'
import {
  addGitWorktree,
  createTempDir,
  createTempGitRepo,
  type TempGitRepo,
} from './_helpers.ts'

const PORCELAIN_FIXTURE = [
  'worktree /tmp/repo',
  'HEAD abc123',
  'branch refs/heads/main',
  '',
  'worktree /tmp/repo-feature-x',
  'HEAD def456',
  'branch refs/heads/feature/x',
  '',
].join('\n')

describe('gitEnvForCwd', () => {
  const previousValues: Record<string, string | undefined> = {}

  beforeEach(() => {
    previousValues.GIT_DIR = process.env.GIT_DIR
    previousValues.GIT_WORK_TREE = process.env.GIT_WORK_TREE
    previousValues.GIT_INDEX_FILE = process.env.GIT_INDEX_FILE
    previousValues.GIT_PREFIX = process.env.GIT_PREFIX
  })

  afterEach(() => {
    for (const key of [
      'GIT_DIR',
      'GIT_INDEX_FILE',
      'GIT_PREFIX',
      'GIT_WORK_TREE',
    ] as const) {
      const original = previousValues[key]
      if (original === undefined) {
        Reflect.deleteProperty(process.env, key)
      } else {
        process.env[key] = original
      }
    }
  })

  it('strips GIT_DIR and friends from the returned env clone', () => {
    process.env.GIT_DIR = '/tmp/sneaky/.git'
    process.env.GIT_WORK_TREE = '/tmp/sneaky'
    process.env.GIT_INDEX_FILE = '/tmp/sneaky/.git/index'
    process.env.GIT_PREFIX = 'sub/'

    const env = gitEnvForCwd()

    expect(env.GIT_DIR).toBeUndefined()
    expect(env.GIT_WORK_TREE).toBeUndefined()
    expect(env.GIT_INDEX_FILE).toBeUndefined()
    expect(env.GIT_PREFIX).toBeUndefined()
  })

  it('does not mutate process.env', () => {
    process.env.GIT_DIR = '/tmp/keep-me/.git'
    gitEnvForCwd()
    expect(process.env.GIT_DIR).toBe('/tmp/keep-me/.git')
  })
})

describe('parseWorktreeRoots', () => {
  it('returns absolute paths from porcelain output, ignoring HEAD and branch lines', () => {
    const roots = parseWorktreeRoots(PORCELAIN_FIXTURE)

    expect(roots).toHaveLength(2)
    expect(roots[0]).toBe(normalizePath('/tmp/repo'))
    expect(roots[1]).toBe(normalizePath('/tmp/repo-feature-x'))
    for (const r of roots) {
      expect(isAbsolute(r)).toBe(true)
    }
  })

  it('returns an empty array for empty input', () => {
    expect(parseWorktreeRoots('')).toEqual([])
  })
})

describe('detectGitWorktreeContext', () => {
  let repo: null | TempGitRepo = null
  const cleanupPaths: string[] = []

  afterEach(() => {
    if (repo) {
      repo.cleanup()
      repo = null
    }
    while (cleanupPaths.length > 0) {
      const p = cleanupPaths.pop()
      if (p !== undefined) {
        rmSync(p, { force: true, recursive: true })
      }
    }
  })

  it('returns ok with populated absolute paths for a fresh git repo', () => {
    repo = createTempGitRepo()
    const result = detectGitWorktreeContext(repo.root)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const ctx = result.value
    expect(ctx.currentRoot).toBe(normalizePath(repo.root))
    expect(ctx.mainRoot).toBe(normalizePath(repo.root))
    expect(isAbsolute(ctx.gitCommonDir)).toBe(true)
    expect(ctx.gitCommonDir.endsWith('.git')).toBe(true)
    expect(ctx.worktreeRoots).toHaveLength(1)
    expect(ctx.worktreeRoots[0]).toBe(normalizePath(repo.root))
  })

  it('returns err NOT_A_GIT_REPO for a non-git directory', () => {
    const dir = createTempDir()
    try {
      const result = detectGitWorktreeContext(dir.path)
      expect(result.ok).toBe(false)
      if (result.ok) {
        return
      }
      expect(result.error.code).toBe(PW_ERROR_CODES.NOT_A_GIT_REPO)
    } finally {
      dir.cleanup()
    }
  })

  it('returns the feature worktree root as currentRoot from inside an added worktree', () => {
    repo = createTempGitRepo()
    const featureSuffix = `feat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const featurePath = join(repo.root, '..', featureSuffix)
    cleanupPaths.push(featurePath)
    addGitWorktree(repo.root, `feature/${featureSuffix}`, featurePath)

    const result = detectGitWorktreeContext(featurePath)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const ctx = result.value
    expect(ctx.currentRoot).toBe(normalizePath(featurePath))
    expect(ctx.mainRoot).toBe(normalizePath(repo.root))
    expect(ctx.worktreeRoots).toHaveLength(2)
  })
})
