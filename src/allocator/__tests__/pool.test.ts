import { describe, expect, it } from 'vitest'
import type { PoolSpec } from '../../config/index.ts'
import { entryFitsPlacement } from '../placement.ts'
import {
  findFreeBlock,
  findFreeSlot,
  POOL_END_DEFAULT,
  POOL_START_DEFAULT,
  resolvePoolRange,
  slotBasePort,
} from '../pool.ts'

const DEFAULT_RANGE = { end: POOL_END_DEFAULT, start: POOL_START_DEFAULT }

describe('findFreeBlock', () => {
  it('returns range.start when pool is empty', () => {
    expect(findFreeBlock([], 3, DEFAULT_RANGE)).toBe(30000)
  })

  it('returns range.start for a single-port request with empty pool', () => {
    expect(findFreeBlock([], 1, DEFAULT_RANGE)).toBe(30000)
  })

  it('finds first block that avoids all occupied ports', () => {
    const occupied = [30000, 30001, 30002]
    expect(findFreeBlock(occupied, 2, DEFAULT_RANGE)).toBe(30003)
  })

  it('skips past a conflict in the middle of a candidate window', () => {
    // Occupied: 30001 falls inside [30000, 30001] window
    const occupied = [30001]
    expect(findFreeBlock(occupied, 2, DEFAULT_RANGE)).toBe(30002)
  })

  it('handles multiple conflicts with gaps between them', () => {
    const occupied = [30000, 30005, 30010]
    // [30001, 30004] would work for slotCount=3: 30001,30002,30003
    expect(findFreeBlock(occupied, 3, DEFAULT_RANGE)).toBe(30001)
  })

  it('returns null when pool is fully exhausted', () => {
    // Fill from 30000 to 59999 entirely — no gaps
    const occupied: number[] = []
    for (let i = 30000; i < 60000; i++) {
      occupied.push(i)
    }
    expect(findFreeBlock(occupied, 1, DEFAULT_RANGE)).toBeNull()
  })

  it('returns null when slotCount is larger than the remaining pool space', () => {
    // Only 2 ports left at the end: 59998, 59999
    const occupied: number[] = []
    for (let i = 30000; i < 59998; i++) {
      occupied.push(i)
    }
    expect(findFreeBlock(occupied, 3, DEFAULT_RANGE)).toBeNull()
  })

  it('respects a custom pool range', () => {
    const customRange = { end: 35000, start: 33000 }
    expect(findFreeBlock([], 2, customRange)).toBe(33000)
  })

  it('returns null when custom range is too narrow for slotCount', () => {
    // Range [33000, 33002) = 2 ports; request 3
    const customRange = { end: 33002, start: 33000 }
    expect(findFreeBlock([], 3, customRange)).toBeNull()
  })

  it('skips occupied ports below range.start', () => {
    const occupied = [5000, 10000]
    expect(findFreeBlock(occupied, 2, DEFAULT_RANGE)).toBe(30000)
  })

  it('handles a single-port slot with a gap at range.start', () => {
    const occupied = [30000]
    expect(findFreeBlock(occupied, 1, DEFAULT_RANGE)).toBe(30001)
  })
})

describe('resolvePoolRange', () => {
  // Silenced stderr for tests asserting fallback behavior — the warning is
  // verified separately in the dedicated warning tests below.
  const silentStderr = {
    write: (): boolean => true,
  }

  it('returns the default range when env var is absent', () => {
    expect(resolvePoolRange({}, silentStderr)).toEqual(DEFAULT_RANGE)
  })

  it('returns the default range when env var is empty', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('parses a valid override', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '40000-50000' }, silentStderr),
    ).toEqual({
      end: 50000,
      start: 40000,
    })
  })

  it('falls back on non-integer values', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: 'abc-def' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back on inverted range (start >= end)', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '50000-40000' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back on equal start and end', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '40000-40000' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back on non-positive start', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '0-50000' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back on negative start', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '-1000-50000' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back on float values', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '30000.5-60000' }, silentStderr),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back on extra segments', () => {
    expect(
      resolvePoolRange(
        { PORTWEAVE_POOL_RANGE: '30000-50000-60000' },
        silentStderr,
      ),
    ).toEqual(DEFAULT_RANGE)
  })

  it('falls back when start is below the privileged-port floor (1024)', () => {
    const warnings: string[] = []
    const stderr = {
      write: (msg: string): boolean => {
        warnings.push(msg)
        return true
      },
    }
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '512-2000' }, stderr),
    ).toEqual(DEFAULT_RANGE)
    expect(warnings.join('')).toContain('PORTWEAVE_POOL_RANGE="512-2000"')
  })

  it('accepts start exactly at the privileged-port floor', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '1024-2048' }, silentStderr),
    ).toEqual({ end: 2048, start: 1024 })
  })

  it('emits a stderr warning when the override is malformed', () => {
    const warnings: string[] = []
    const stderr = {
      write: (msg: string): boolean => {
        warnings.push(msg)
        return true
      },
    }
    resolvePoolRange({ PORTWEAVE_POOL_RANGE: 'not-a-range' }, stderr)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('PORTWEAVE_POOL_RANGE="not-a-range" ignored')
    expect(warnings[0]).toContain('30000-60000')
  })

  it('does NOT warn when the override is absent (no env var set)', () => {
    const warnings: string[] = []
    const stderr = {
      write: (msg: string): boolean => {
        warnings.push(msg)
        return true
      },
    }
    resolvePoolRange({}, stderr)
    expect(warnings).toHaveLength(0)
  })

  it('does NOT warn when the override is a valid range', () => {
    const warnings: string[] = []
    const stderr = {
      write: (msg: string): boolean => {
        warnings.push(msg)
        return true
      },
    }
    resolvePoolRange({ PORTWEAVE_POOL_RANGE: '40000-50000' }, stderr)
    expect(warnings).toHaveLength(0)
  })
})

const SLOT_POOL: PoolSpec = {
  basePort: 3000,
  mode: 'slots',
  primarySlot: 0,
  slots: 10,
  stride: 10,
}

describe('slotBasePort', () => {
  it('places slot 0 at basePort', () => {
    expect(slotBasePort(SLOT_POOL, 0)).toBe(3000)
  })

  it('advances by stride per slot', () => {
    expect(slotBasePort(SLOT_POOL, 1)).toBe(3010)
    expect(slotBasePort(SLOT_POOL, 9)).toBe(3090)
  })
})

describe('findFreeSlot', () => {
  it('pins the primary worktree to primarySlot even when later slots are free', () => {
    expect(findFreeSlot([], 2, SLOT_POOL, true)).toBe(3000)
  })

  it('returns null for the primary worktree when its pinned slot is taken', () => {
    // Deliberately does NOT fall through to slot 1 — drifting off the pinned
    // slot is what would break anything pre-registered against those ports.
    expect(findFreeSlot([3001], 2, SLOT_POOL, true)).toBeNull()
  })

  it('gives a linked worktree the lowest slot above the primary', () => {
    expect(findFreeSlot([3000, 3001], 2, SLOT_POOL, false)).toBe(3010)
  })

  it('never hands a linked worktree the primary slot, even when it is free', () => {
    expect(findFreeSlot([], 2, SLOT_POOL, false)).toBe(3010)
  })

  it('skips a whole slot when any one of its ports is occupied', () => {
    // 3011 occupied retires slot 1 entirely; the next base stays on the stride
    // rather than becoming 3012 the way first-fit would.
    expect(findFreeSlot([3011], 2, SLOT_POOL, false)).toBe(3020)
  })

  it('honours a non-zero primarySlot in both directions', () => {
    const pool: PoolSpec = { ...SLOT_POOL, primarySlot: 3 }
    expect(findFreeSlot([], 2, pool, true)).toBe(3030)
    expect(findFreeSlot([3000, 3001], 2, pool, false)).toBe(3010)
  })

  it('returns null once every non-primary slot is occupied', () => {
    const occupied: number[] = []
    for (let slot = 1; slot < SLOT_POOL.slots; slot += 1) {
      occupied.push(slotBasePort(SLOT_POOL, slot))
    }
    expect(findFreeSlot(occupied, 2, SLOT_POOL, false)).toBeNull()
  })

  it('accounts for the full service width when testing a slot', () => {
    const wide: PoolSpec = { ...SLOT_POOL, stride: 4 }
    // slot 1 spans 3004..3007; an occupant at 3007 must retire it
    expect(findFreeSlot([3007], 4, wide, false)).toBe(3008)
  })
})

describe('entryFitsPlacement', () => {
  const slotPlacement = (
    overrides: Partial<PoolSpec> = {},
    isPrimary = false,
  ) => ({
    isPrimary,
    pool: { ...SLOT_POOL, ...overrides },
    range: { end: 0, start: 0 },
  })

  it('accepts nothing-to-violate in first-fit mode', () => {
    expect(
      entryFitsPlacement([48123, 48124], {
        isPrimary: false,
        pool: null,
        range: { end: 60000, start: 30000 },
      }),
    ).toBe(true)
  })

  it('accepts a block sitting exactly on a slot base', () => {
    expect(entryFitsPlacement([3010, 3011], slotPlacement())).toBe(true)
  })

  it('rejects a block below basePort', () => {
    expect(entryFitsPlacement([2990, 2991], slotPlacement())).toBe(false)
  })

  it('rejects a block off the stride', () => {
    expect(entryFitsPlacement([3013, 3014], slotPlacement())).toBe(false)
  })

  it('rejects a block past the last slot', () => {
    expect(entryFitsPlacement([3100, 3101], slotPlacement())).toBe(false)
  })

  it('rejects a linked worktree squatting on the primary slot', () => {
    expect(entryFitsPlacement([3000, 3001], slotPlacement())).toBe(false)
  })

  it('rejects the primary worktree sitting anywhere but its slot', () => {
    expect(entryFitsPlacement([3010, 3011], slotPlacement({}, true))).toBe(
      false,
    )
    expect(entryFitsPlacement([3000, 3001], slotPlacement({}, true))).toBe(true)
  })

  it('rejects a block whose geometry only fits the OLD basePort', () => {
    // The concrete case: a worktree allocated under basePort 3000, then the
    // config moved to 6100. The ports still work — they are just no longer in
    // the set that was registered with the OAuth provider.
    expect(
      entryFitsPlacement([3010, 3011], slotPlacement({ basePort: 6100 })),
    ).toBe(false)
  })
})
