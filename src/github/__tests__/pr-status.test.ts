import type { SpawnSyncReturns } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GhRun, RunGh } from '../pr-status.ts'
import { fetchPrStatus, ghIsAvailable } from '../pr-status.ts'

const spawnSyncMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: spawnSyncMock }
})

function spawnResult(
  overrides: Partial<SpawnSyncReturns<string>>,
): SpawnSyncReturns<string> {
  return {
    output: [],
    pid: 1,
    signal: null,
    status: 0,
    stderr: '',
    stdout: '',
    ...overrides,
  }
}

function stubGh(stdout: string): RunGh {
  return () => Promise.resolve<GhRun>({ stdout })
}

afterEach(() => {
  spawnSyncMock.mockReset()
})

describe('fetchPrStatus', () => {
  it('normalizes OPEN with number + url', async () => {
    const json = JSON.stringify({
      number: 42,
      state: 'OPEN',
      url: 'https://github.com/o/r/pull/42',
    })
    const status = await fetchPrStatus('/wt', stubGh(json))
    expect(status).toEqual({
      number: 42,
      state: 'open',
      url: 'https://github.com/o/r/pull/42',
    })
  })

  it('normalizes CLOSED → closed', async () => {
    const status = await fetchPrStatus(
      '/wt',
      stubGh(JSON.stringify({ number: 7, state: 'CLOSED', url: null })),
    )
    expect(status?.state).toBe('closed')
  })

  it('normalizes MERGED → merged', async () => {
    const status = await fetchPrStatus(
      '/wt',
      stubGh(JSON.stringify({ number: 9, state: 'MERGED', url: 'u' })),
    )
    expect(status?.state).toBe('merged')
  })

  it('passes the gh pr view args and cwd through to the runner', async () => {
    const runGh = vi.fn<RunGh>(() =>
      Promise.resolve({ stdout: JSON.stringify({ state: 'OPEN' }) }),
    )
    await fetchPrStatus('/some/worktree', runGh)
    expect(runGh).toHaveBeenCalledWith(
      ['pr', 'view', '--json', 'state,number,url'],
      '/some/worktree',
    )
  })

  it('falls back to null number/url when those fields are absent', async () => {
    const status = await fetchPrStatus(
      '/wt',
      stubGh(JSON.stringify({ state: 'OPEN' })),
    )
    expect(status).toEqual({ number: null, state: 'open', url: null })
  })

  it('returns null (no throw) when the runner rejects — no PR / non-zero exit', async () => {
    const failing: RunGh = () => Promise.reject(new Error('exit 1'))
    await expect(fetchPrStatus('/wt', failing)).resolves.toBeNull()
  })

  it('returns null for an unrecognized state value', async () => {
    const status = await fetchPrStatus(
      '/wt',
      stubGh(JSON.stringify({ state: 'DRAFT' })),
    )
    expect(status).toBeNull()
  })

  it('returns null for malformed JSON', async () => {
    expect(await fetchPrStatus('/wt', stubGh('not json'))).toBeNull()
  })

  it('returns null when stdout parses to a non-object', async () => {
    expect(await fetchPrStatus('/wt', stubGh('true'))).toBeNull()
  })
})

describe('ghIsAvailable', () => {
  it('is true when gh auth status exits 0', () => {
    spawnSyncMock.mockReturnValue(spawnResult({ status: 0 }))
    expect(ghIsAvailable()).toBe(true)
  })

  it('is false on a non-zero exit (unauthenticated)', () => {
    spawnSyncMock.mockReturnValue(spawnResult({ status: 1 }))
    expect(ghIsAvailable()).toBe(false)
  })

  it('is false when the binary is missing (ENOENT)', () => {
    const enoent = Object.assign(new Error('spawn gh ENOENT'), {
      code: 'ENOENT',
    })
    spawnSyncMock.mockReturnValue(spawnResult({ error: enoent, status: null }))
    expect(ghIsAvailable()).toBe(false)
  })

  it('invokes gh auth status', () => {
    spawnSyncMock.mockReturnValue(spawnResult({ status: 0 }))
    ghIsAvailable()
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'gh',
      ['auth', 'status'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })
})
