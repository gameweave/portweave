import { describe, expect, it, vi } from 'vitest'
import type { PanelPrStatus, WorktreeKind } from '../types.ts'
import type { TriageDeps } from '../triage-cache.ts'
import { createTriageProvider, PANEL_TRIAGE_TTL_MS } from '../triage-cache.ts'

const MERGED_PR: PanelPrStatus = {
  number: 7,
  state: 'merged',
  url: 'https://example.com/pr/7',
}

interface StubControls {
  readonly detectKind: ReturnType<typeof vi.fn>
  readonly diskSizeBytes: ReturnType<typeof vi.fn>
  readonly fetchPrStatus: ReturnType<typeof vi.fn>
  readonly ghIsAvailable: ReturnType<typeof vi.fn>
  readonly setNow: (ms: number) => void
  readonly worktreeBranch: ReturnType<typeof vi.fn>
  readonly worktreeIsClean: ReturnType<typeof vi.fn>
}

function makeDeps(overrides?: {
  readonly branch?: null | string
  readonly ghAvailable?: boolean
  readonly kind?: WorktreeKind
  readonly prStatus?: null | PanelPrStatus
  readonly size?: null | number
  readonly startNow?: number
  readonly workingTreeClean?: boolean | null
}): { controls: StubControls; deps: TriageDeps } {
  const opts = overrides ?? {}
  let nowMs = opts.startNow ?? 1_000
  const detectKind = vi.fn(
    (_worktreeRoot: string): WorktreeKind => opts.kind ?? 'linked',
  )
  // `size`/`clean` use `in` (not `??`) so an explicit null override survives
  // instead of being coalesced back to the default.
  const diskSizeBytes = vi.fn(
    (_worktreeRoot: string): Promise<null | number> =>
      Promise.resolve('size' in opts ? (opts.size ?? null) : 4096),
  )
  const fetchPrStatus = vi.fn(
    (_worktreeRoot: string): Promise<null | PanelPrStatus> =>
      Promise.resolve(opts.prStatus ?? MERGED_PR),
  )
  const ghIsAvailable = vi.fn((): boolean => opts.ghAvailable ?? true)
  const worktreeBranch = vi.fn(
    (_worktreeRoot: string): null | string =>
      'branch' in opts ? (opts.branch ?? null) : 'feature/panel-branch-name',
  )
  const worktreeIsClean = vi.fn((_worktreeRoot: string): boolean | null =>
    'workingTreeClean' in opts ? (opts.workingTreeClean ?? null) : true,
  )
  const deps: TriageDeps = {
    detectKind,
    diskSizeBytes,
    fetchPrStatus,
    ghIsAvailable,
    now: () => nowMs,
    worktreeBranch,
    worktreeIsClean,
  }

  return {
    controls: {
      detectKind,
      diskSizeBytes,
      fetchPrStatus,
      ghIsAvailable,
      setNow: (ms) => {
        nowMs = ms
      },
      worktreeBranch,
      worktreeIsClean,
    },
    deps,
  }
}

const ROOT = '/tmp/wt-a'

describe('PANEL_TRIAGE_TTL_MS', () => {
  it('is 60 seconds', () => {
    expect(PANEL_TRIAGE_TTL_MS).toBe(60_000)
  })
})

describe('createTriageProvider', () => {
  it('computes a full triage on a cache miss', async () => {
    const { controls, deps } = makeDeps()
    const provider = createTriageProvider({ deps })

    const triage = await provider.triageFor(ROOT)

    expect(triage).toEqual({
      branch: 'feature/panel-branch-name',
      diskSizeBytes: 4096,
      kind: 'linked',
      prStatus: MERGED_PR,
      workingTreeClean: true,
    })
    expect(controls.detectKind).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(controls.fetchPrStatus).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(controls.worktreeBranch).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(controls.worktreeIsClean).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(controls.diskSizeBytes).toHaveBeenCalledExactlyOnceWith(ROOT)
  })

  it('returns the cached entry within the TTL without recomputing', async () => {
    const { controls, deps } = makeDeps({ startNow: 1_000 })
    const provider = createTriageProvider({ deps })

    const first = await provider.triageFor(ROOT)
    controls.setNow(1_000 + PANEL_TRIAGE_TTL_MS - 1)
    const second = await provider.triageFor(ROOT)

    expect(second).toBe(first)
    expect(controls.detectKind).toHaveBeenCalledTimes(1)
    expect(controls.fetchPrStatus).toHaveBeenCalledTimes(1)
    expect(controls.worktreeBranch).toHaveBeenCalledTimes(1)
    expect(controls.worktreeIsClean).toHaveBeenCalledTimes(1)
    expect(controls.diskSizeBytes).toHaveBeenCalledTimes(1)
  })

  it('recomputes once the TTL has elapsed', async () => {
    const { controls, deps } = makeDeps({ startNow: 1_000 })
    const provider = createTriageProvider({ deps })

    await provider.triageFor(ROOT)
    controls.setNow(1_000 + PANEL_TRIAGE_TTL_MS)
    await provider.triageFor(ROOT)

    expect(controls.detectKind).toHaveBeenCalledTimes(2)
    expect(controls.fetchPrStatus).toHaveBeenCalledTimes(2)
    expect(controls.worktreeBranch).toHaveBeenCalledTimes(2)
    expect(controls.worktreeIsClean).toHaveBeenCalledTimes(2)
    expect(controls.diskSizeBytes).toHaveBeenCalledTimes(2)
  })

  it('recomputes on a per-call force, even within the TTL', async () => {
    const { controls, deps } = makeDeps({ startNow: 1_000 })
    const provider = createTriageProvider({ deps })

    await provider.triageFor(ROOT)
    // Clock unchanged: a non-force call would serve the cache here.
    await provider.triageFor(ROOT, true)

    expect(controls.detectKind).toHaveBeenCalledTimes(2)
    expect(controls.fetchPrStatus).toHaveBeenCalledTimes(2)
  })

  it('warms the cache on a force, so the next non-force call is served from it', async () => {
    const { controls, deps } = makeDeps({ startNow: 1_000 })
    const provider = createTriageProvider({ deps })

    // Force recompute within the TTL, then a plain read at the same clock.
    const forced = await provider.triageFor(ROOT, true)
    const cached = await provider.triageFor(ROOT)

    // The forced result was stored: the plain read returns it without
    // re-invoking the underlying stubs (one compute total).
    expect(cached).toBe(forced)
    expect(controls.detectKind).toHaveBeenCalledTimes(1)
    expect(controls.fetchPrStatus).toHaveBeenCalledTimes(1)
    expect(controls.worktreeBranch).toHaveBeenCalledTimes(1)
    expect(controls.worktreeIsClean).toHaveBeenCalledTimes(1)
    expect(controls.diskSizeBytes).toHaveBeenCalledTimes(1)
  })

  it('caches per worktreeRoot (distinct keys do not share entries)', async () => {
    const { controls, deps } = makeDeps()
    const provider = createTriageProvider({ deps })

    await provider.triageFor('/tmp/wt-a')
    await provider.triageFor('/tmp/wt-b')
    await provider.triageFor('/tmp/wt-a')

    expect(controls.detectKind).toHaveBeenCalledTimes(2)
    expect(controls.detectKind).toHaveBeenNthCalledWith(1, '/tmp/wt-a')
    expect(controls.detectKind).toHaveBeenNthCalledWith(2, '/tmp/wt-b')
  })
})

describe('createTriageProvider — gh availability + construction', () => {
  it('computes prStatusAvailable once at creation and exposes it', () => {
    const { controls, deps } = makeDeps({ ghAvailable: true })
    const provider = createTriageProvider({ deps })

    expect(provider.prStatusAvailable).toBe(true)
    expect(controls.ghIsAvailable).toHaveBeenCalledTimes(1)
  })

  it('does not re-check ghIsAvailable per triage call', async () => {
    const { controls, deps } = makeDeps()
    const provider = createTriageProvider({ deps })

    await provider.triageFor('/tmp/wt-a')
    await provider.triageFor('/tmp/wt-b')

    expect(controls.ghIsAvailable).toHaveBeenCalledTimes(1)
  })

  it('skips fetchPrStatus and yields null prStatus when gh is unavailable', async () => {
    const { controls, deps } = makeDeps({ ghAvailable: false })
    const provider = createTriageProvider({ deps })

    const triage = await provider.triageFor(ROOT)

    expect(provider.prStatusAvailable).toBe(false)
    expect(triage.prStatus).toBeNull()
    expect(controls.fetchPrStatus).not.toHaveBeenCalled()
    expect(controls.diskSizeBytes).toHaveBeenCalledTimes(1)
    expect(controls.worktreeIsClean).toHaveBeenCalledTimes(1)
  })

  it('runs the async pr + size fetches concurrently', async () => {
    let resolvePr: (value: null | PanelPrStatus) => void = (_value) => undefined
    let resolveSize: (value: null | number) => void = (_value) => undefined
    const order: string[] = []

    const deps: TriageDeps = {
      detectKind: () => 'linked',
      diskSizeBytes: () =>
        new Promise<null | number>((resolve) => {
          resolveSize = (value) => {
            order.push('size')
            resolve(value)
          }
        }),
      fetchPrStatus: () =>
        new Promise<null | PanelPrStatus>((resolve) => {
          resolvePr = (value) => {
            order.push('pr')
            resolve(value)
          }
        }),
      ghIsAvailable: () => true,
      now: () => 1_000,
      worktreeBranch: () => 'feature/async',
      worktreeIsClean: () => true,
    }

    const provider = createTriageProvider({ deps })
    const pending = provider.triageFor(ROOT)

    // Both invoked before either resolved; size-then-pr proves they overlap.
    resolveSize(2048)
    resolvePr(MERGED_PR)
    const triage = await pending

    expect(order).toEqual(['size', 'pr'])
    expect(triage.diskSizeBytes).toBe(2048)
    expect(triage.prStatus).toBe(MERGED_PR)
  })

  it('propagates a null/unknown clean state and null disk size', async () => {
    const { deps } = makeDeps({ size: null, workingTreeClean: null })
    const provider = createTriageProvider({ deps })

    const triage = await provider.triageFor(ROOT)

    expect(triage.workingTreeClean).toBeNull()
    expect(triage.diskSizeBytes).toBeNull()
  })

  it('propagates a null branch when detached or git is unavailable', async () => {
    const { deps } = makeDeps({ branch: null })
    const provider = createTriageProvider({ deps })

    const triage = await provider.triageFor(ROOT)

    expect(triage.branch).toBeNull()
  })

  it('constructs with no options (defaults to the real boundary imports)', () => {
    // Production no-deps path: real ghIsAvailable() runs, so assert shape only.
    const provider = createTriageProvider()

    expect(typeof provider.prStatusAvailable).toBe('boolean')
    expect(typeof provider.triageFor).toBe('function')
  })

  it('accepts a per-call force with stubbed deps and recomputes', async () => {
    const { controls, deps } = makeDeps()
    const provider = createTriageProvider({ deps })

    await provider.triageFor(ROOT, true)

    expect(controls.detectKind).toHaveBeenCalledExactlyOnceWith(ROOT)
  })
})
