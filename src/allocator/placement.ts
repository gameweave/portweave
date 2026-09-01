import type { Config, PoolSpec } from '../config/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import type { AllocationKey } from '../registry/types.ts'
import { MAIN_NAMESPACE } from '../worktree/namespace.ts'
import {
  findFreeBlock,
  findFreeSlot,
  type PoolRange,
  resolvePoolRange,
  slotBasePort,
} from './pool.ts'

// Where a fresh block may land. `pool === null` is the historical first-fit
// scan over `range`; a non-null pool switches to fixed-stride slots, where
// `range` is unused and the primary worktree is pinned to pool.primarySlot.
export interface Placement {
  readonly isPrimary: boolean
  readonly pool: null | PoolSpec
  readonly range: PoolRange
}

// Never consulted in slot mode — slot geometry comes from the config's pool
// block, not the machine-wide range. A sentinel keeps Placement.range
// non-optional so the first-fit path needs no narrowing.
const DISABLED_RANGE: PoolRange = { end: 0, start: 0 }

/**
 * Does an already-allocated block still satisfy the current placement rules?
 *
 * Reuse is otherwise unconditional (decision-log #37), which is right for a
 * stable config — but the pool block is part of the config, and editing
 * `basePort` / `stride` / `slots` / `primarySlot` silently left every existing
 * worktree on ports outside the new geometry. That failure is invisible: the
 * ports still work, they are just no longer in the set anyone pre-registered.
 * Same reconciliation intent as the config-growth check in `tryReuseExisting`.
 *
 * First-fit mode has no geometry to violate, so nothing is rejected there.
 */
export function entryFitsPlacement(
  ports: readonly number[],
  placement: Placement,
): boolean {
  if (placement.pool === null) {
    return true
  }
  const { basePort, primarySlot, slots, stride } = placement.pool
  const first = Math.min(...ports)
  const offset = first - basePort
  if (offset < 0 || offset % stride !== 0) {
    return false
  }
  const slot = offset / stride
  if (slot >= slots) {
    return false
  }
  // The primary worktree owns primarySlot and nobody else may hold it, so a
  // block on the wrong side of that rule has to be re-rolled too.
  if (placement.isPrimary !== (slot === primarySlot)) {
    return false
  }
  const last = first + ports.length - 1
  return ports.every((port) => port >= first && port <= last)
}

export function pickCandidate(
  allOccupied: readonly number[],
  slotCount: number,
  placement: Placement,
): null | number {
  if (placement.pool === null) {
    return findFreeBlock(allOccupied, slotCount, placement.range)
  }
  return findFreeSlot(
    allOccupied,
    slotCount,
    placement.pool,
    placement.isPrimary,
  )
}

export function noCandidateError(placement: Placement): PortweaveError {
  if (placement.pool === null) {
    return new PortweaveError(
      PW_ERROR_CODES.ALLOCATION_EXHAUSTED,
      'Port pool exhausted: no contiguous block available in registry',
    )
  }
  if (placement.isPrimary) {
    // Drifting the primary worktree off its pinned slot would silently break
    // whatever was pre-registered against those ports (OAuth redirect URIs
    // above all), so this is a hard stop rather than a fallback.
    const base = slotBasePort(placement.pool, placement.pool.primarySlot)
    return new PortweaveError(
      PW_ERROR_CODES.ALLOCATION_PRIMARY_SLOT_BUSY,
      `primary slot ${String(placement.pool.primarySlot)} (from port ${String(base)}) is occupied — free it, or run "portweave prune --path <dir>" if a stale worktree entry holds it`,
    )
  }
  return new PortweaveError(
    PW_ERROR_CODES.ALLOCATION_EXHAUSTED,
    `all ${String(placement.pool.slots)} slots are in use — raise pool.slots in portweave.config.json, or prune stale worktree entries`,
  )
}

export function resolvePlacement(
  key: AllocationKey,
  config: Config,
  env: NodeJS.ProcessEnv,
  stderr: { write: (msg: string) => boolean },
): Placement {
  const pool = config.pool ?? null
  if (pool !== null && env.PORTWEAVE_POOL_RANGE !== undefined) {
    stderr.write(
      `[portweave] PORTWEAVE_POOL_RANGE ignored — this project pins ports with "pool": { "mode": "slots" } in portweave.config.json\n`,
    )
  }
  return {
    isPrimary: key.namespace === MAIN_NAMESPACE,
    pool,
    // Unused in slot mode; resolved only when first-fit is actually in play so
    // a bad PORTWEAVE_POOL_RANGE does not warn twice.
    range: pool === null ? resolvePoolRange(env) : DISABLED_RANGE,
  }
}
