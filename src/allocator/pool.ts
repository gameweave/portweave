import { type PoolSpec, PORT_PRIVILEGED_FLOOR } from '../config/index.ts'

export const POOL_START_DEFAULT = 30000 as const
export const POOL_END_DEFAULT = 60000 as const

export interface PoolRange {
  readonly end: number
  readonly start: number
}

/**
 * Parse PORTWEAVE_POOL_RANGE from the environment.
 *
 * Format: "<start>-<end>" where both are integers, start >= 1024, and
 * start < end. Malformed, non-integer, privileged, or inverted values fall
 * back to the default and emit a one-line warning to stderr so a typo
 * doesn't silently produce surprising allocations.
 *
 * The fallback semantics match PORTWEAVE_LOCK_TIMEOUT_MS (decision-log #19);
 * the difference is the warning line — silent fallback was discovered to be
 * surprising in the v0 review pass.
 */
export function resolvePoolRange(
  env: NodeJS.ProcessEnv = process.env,
  stderr: { write: (msg: string) => boolean } = process.stderr,
): PoolRange {
  const raw = env.PORTWEAVE_POOL_RANGE
  if (raw === undefined || raw.length === 0) {
    return { end: POOL_END_DEFAULT, start: POOL_START_DEFAULT }
  }
  const parts = raw.split('-')
  if (parts.length === 2) {
    const start = Number(parts[0])
    const end = Number(parts[1])
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= PORT_PRIVILEGED_FLOOR &&
      end > start
    ) {
      return { end, start }
    }
  }
  stderr.write(
    `[portweave] PORTWEAVE_POOL_RANGE="${raw}" ignored — using default ${POOL_START_DEFAULT.toString()}-${POOL_END_DEFAULT.toString()} (format: <start>-<end>, integers, start >= ${PORT_PRIVILEGED_FLOOR.toString()}, end > start)\n`,
  )
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

/**
 * The first port of slot `slotIndex` — slot i spans
 * [basePort + i*stride, basePort + i*stride + serviceCount - 1].
 *
 * Pure. Exported because `portweave slots` enumerates the same geometry the
 * allocator uses; there must be exactly one definition of where a slot starts.
 */
export function slotBasePort(pool: PoolSpec, slotIndex: number): number {
  return pool.basePort + slotIndex * pool.stride
}

function slotIsFree(
  occupiedSorted: readonly number[],
  base: number,
  serviceCount: number,
): boolean {
  const end = base + serviceCount - 1
  return !occupiedSorted.some((port) => port >= base && port <= end)
}

/**
 * Pick this worktree's slot base port.
 *
 * The primary worktree always gets `pool.primarySlot`, occupancy notwithstanding
 * — pinning is the contract that makes the slot set pre-registerable with an
 * OAuth provider, so a busy primary slot must surface as an error upstream
 * rather than drift to a port nobody registered. Linked worktrees take the
 * lowest free slot, skipping the primary's.
 *
 * Pure — no I/O. The probe loop in allocate.ts calls it repeatedly, each call
 * passing an enlarged "occupied" set as probes fail. Because a failed probe
 * retires the whole slot rather than advancing one port, slot boundaries stay
 * on the declared stride no matter how many probes fail.
 */
export function findFreeSlot(
  occupiedSorted: readonly number[],
  serviceCount: number,
  pool: PoolSpec,
  isPrimary: boolean,
): null | number {
  if (isPrimary) {
    const base = slotBasePort(pool, pool.primarySlot)
    return slotIsFree(occupiedSorted, base, serviceCount) ? base : null
  }
  for (let index = 0; index < pool.slots; index += 1) {
    if (index === pool.primarySlot) {
      continue
    }
    const base = slotBasePort(pool, index)
    if (slotIsFree(occupiedSorted, base, serviceCount)) {
      return base
    }
  }
  return null
}
