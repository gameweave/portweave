import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import { normalizePath } from '../git.ts'
import { resolveAllocationKey } from '../key.ts'
import {
  addGitWorktree,
  createTempDir,
  createTempGitRepo,
  type TempGitRepo,
} from './_helpers.ts'

interface TestState {
  cleanupPaths: string[]
  repo: null | TempGitRepo
}

function newState(): TestState {
  return { cleanupPaths: [], repo: null }
}

describe('resolveAllocationKey', () => {
  let state = newState()

  afterEach(() => {
    if (state.repo) {
      state.repo.cleanup()
    }
    while (state.cleanupPaths.length > 0) {
      const p = state.cleanupPaths.pop()
      if (p !== undefined) {
        rmSync(p, { force: true, recursive: true })
      }
    }
    vi.unstubAllEnvs()
    state = newState()
  })

  it('against a fresh git repo returns ok with main namespace', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')

    const result = resolveAllocationKey(state.repo.root)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const key = result.value
    expect(key.worktreeRoot).toBe(normalizePath(state.repo.root))
    expect(key.gitCommonDir).not.toBeNull()
    expect(key.gitCommonDir?.endsWith('.git')).toBe(true)
    expect(key.namespace).toBe('main')
    expect(key.offsetOverride).toBeNull()
  })

  it('against a feature worktree returns a slug-hash namespace and shared common dir', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')

    const featureSuffix = `feat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const featurePath = join(state.repo.root, '..', featureSuffix)
    state.cleanupPaths.push(featurePath)
    addGitWorktree(state.repo.root, `feature/${featureSuffix}`, featurePath)

    const mainResult = resolveAllocationKey(state.repo.root)
    const featureResult = resolveAllocationKey(featurePath)

    expect(mainResult.ok).toBe(true)
    expect(featureResult.ok).toBe(true)
    if (!mainResult.ok || !featureResult.ok) {
      return
    }

    expect(featureResult.value.worktreeRoot).toBe(normalizePath(featurePath))
    expect(featureResult.value.namespace).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/)
    expect(featureResult.value.namespace).not.toBe('main')
    expect(featureResult.value.gitCommonDir).toBe(mainResult.value.gitCommonDir)
  })

  it('against a non-git directory falls back to cwd-as-key', () => {
    const dir = createTempDir()
    state.cleanupPaths.push(dir.path)
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')

    const result = resolveAllocationKey(dir.path)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.gitCommonDir).toBeNull()
    expect(result.value.worktreeRoot).toBe(normalizePath(dir.path))
    expect(result.value.namespace).toBe('main')
  })

  it('honors the stickiness contract: two calls for the same path are deeply equal', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')

    const first = resolveAllocationKey(state.repo.root)
    const second = resolveAllocationKey(state.repo.root)
    expect(first).toStrictEqual(second)
  })

  it('honors the distinctness contract: main vs feature worktree differ', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')

    const featureSuffix = `feat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const featurePath = join(state.repo.root, '..', featureSuffix)
    state.cleanupPaths.push(featurePath)
    addGitWorktree(state.repo.root, `feature/${featureSuffix}`, featurePath)

    const mainKey = resolveAllocationKey(state.repo.root)
    const featureKey = resolveAllocationKey(featurePath)

    expect(mainKey).not.toStrictEqual(featureKey)
    if (mainKey.ok && featureKey.ok) {
      expect(mainKey.value.worktreeRoot).not.toBe(featureKey.value.worktreeRoot)
      expect(mainKey.value.namespace).not.toBe(featureKey.value.namespace)
    }
  })

  it('applies PORTWEAVE_NAMESPACE override to the final namespace', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'My Override!')
    vi.stubEnv('PORTWEAVE_OFFSET', '')

    const result = resolveAllocationKey(state.repo.root)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.namespace).toBe('my-override')
  })

  it('applies PORTWEAVE_OFFSET to offsetOverride', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '12')

    const result = resolveAllocationKey(state.repo.root)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.offsetOverride).toBe(12)
  })

  it('surfaces a bad PORTWEAVE_OFFSET as err WORKTREE_OFFSET_INVALID', () => {
    state.repo = createTempGitRepo()
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', 'not-a-number')

    const result = resolveAllocationKey(state.repo.root)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toBeInstanceOf(PortweaveError)
    expect(result.error.code).toBe(PW_ERROR_CODES.WORKTREE_OFFSET_INVALID)
  })
})
