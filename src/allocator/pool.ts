export const POOL_START_DEFAULT = 30000 as const
export const POOL_END_DEFAULT = 60000 as const

export interface PoolRange {
  readonly end: number
  readonly start: number
}

/**
 * Parse PORTWEAVE_POOL_RANGE from the environment.
 *
 * Format: "<start>-<end>" where both are integers and start < end.
 * Malformed, non-integer, non-positive, or inverted values fall back to the
 * default silently — same precedent as PORTWEAVE_LOCK_TIMEOUT_MS.
 */
export function resolvePoolRange(
  env: NodeJS.ProcessEnv = process.env,
): PoolRange {
  const raw = env.PORTWEAVE_POOL_RANGE
  if (raw !== undefined && raw.length > 0) {
    const parts = raw.split('-')
    if (parts.length === 2) {
      const start = Number(parts[0])
      const end = Number(parts[1])
      if (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start > 0 &&
        end > start
      ) {
        return { end, start }
      }
    }
  }
  return { end: POOL_END_DEFAULT, start: POOL_START_DEFAULT }
}

/**
 * Find the first ascending port at which `slotCount` contiguous ports avoid
 * every entry in `occupiedSorted` and fit within `range`.
 *
 * Pure — no I/O. The probe loop in allocate.ts calls it repeatedly, each
 * call passing an enlarged "occupied" set as probes fail.
 *
 * @param occupiedSorted - Sorted array of currently-occupied ports.
 * @param slotCount - Number of contiguous ports needed.
 * @param range - Pool range (exclusive upper bound).
 * @returns The start port of the first free block, or null if no block fits.
 */
export function findFreeBlock(
  occupiedSorted: readonly number[],
  slotCount: number,
  range: PoolRange,
): null | number {
  let start = range.start
  let oi = 0

  // Advance oi to the first occupied port >= start
  while (oi < occupiedSorted.length && occupiedSorted[oi] < start) {
    oi++
  }

  while (start + slotCount <= range.end) {
    const blockEnd = start + slotCount - 1

    // Find first occupied port within [start, blockEnd]
    while (oi < occupiedSorted.length && occupiedSorted[oi] < start) {
      oi++
    }

    if (oi >= occupiedSorted.length || occupiedSorted[oi] > blockEnd) {
      // No occupied port in [start, blockEnd] — this block is free
      return start
    }

    // Jump past the conflict
    start = occupiedSorted[oi] + 1
    oi++
  }

  return null
}
