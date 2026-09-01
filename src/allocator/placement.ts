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
