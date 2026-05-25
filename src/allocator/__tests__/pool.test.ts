import { describe, expect, it } from 'vitest'
import {
  findFreeBlock,
  POOL_END_DEFAULT,
  POOL_START_DEFAULT,
  resolvePoolRange,
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
  it('returns the default range when env var is absent', () => {
    expect(resolvePoolRange({})).toEqual(DEFAULT_RANGE)
  })

  it('returns the default range when env var is empty', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('parses a valid override', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '40000-50000' })).toEqual({
      end: 50000,
      start: 40000,
    })
  })

  it('falls back on non-integer values', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: 'abc-def' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('falls back on inverted range (start >= end)', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '50000-40000' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('falls back on equal start and end', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '40000-40000' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('falls back on non-positive start', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '0-50000' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('falls back on negative start', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '-1000-50000' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('falls back on float values', () => {
    expect(resolvePoolRange({ PORTWEAVE_POOL_RANGE: '30000.5-60000' })).toEqual(
      DEFAULT_RANGE,
    )
  })

  it('falls back on extra segments', () => {
    expect(
      resolvePoolRange({ PORTWEAVE_POOL_RANGE: '30000-50000-60000' }),
    ).toEqual(DEFAULT_RANGE)
  })
})
