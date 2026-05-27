import type { Config, ServiceSpec } from '../config/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { withRegistry, type WithRegistryHandle } from '../registry/storage.ts'
import type { AllocationKey, RegistryEntry } from '../registry/types.ts'
import { findFreeBlock, type PoolRange, resolvePoolRange } from './pool.ts'
import { probeBlock, probePort } from './probe.ts'

// Allocation is the conceptual layer on top of a RegistryEntry — same shape,
// re-exported here so downstream features depend on the allocator's surface
// rather than reaching into registry types.
export type Allocation = RegistryEntry

export interface AllocationResult {
  readonly allocation: Allocation
  readonly reused: boolean
}

export const MAX_PROBE_RETRIES = 100 as const

/**
 * Re-order services so that services sharing a `group` label are contiguous
 * and groups appear in first-occurrence order. Ungrouped services keep their
 * original sequential position relative to the groups.
 *
 * Pure — no I/O.
 */
export function orderServicesForAllocation(config: Config): ServiceSpec[] {
  const groupFirstSeen = new Map<string, number>()
  for (const [i, s] of config.services.entries()) {
    if (s.group !== undefined && !groupFirstSeen.has(s.group)) {
      groupFirstSeen.set(s.group, i)
    }
  }
  return [...config.services].sort((a, b) => {
    const ai =
      a.group !== undefined
        ? (groupFirstSeen.get(a.group) ?? config.services.indexOf(a))
        : config.services.indexOf(a)
    const bi =
      b.group !== undefined
        ? (groupFirstSeen.get(b.group) ?? config.services.indexOf(b))
        : config.services.indexOf(b)
    if (ai !== bi) {
      return ai - bi
    }
    return config.services.indexOf(a) - config.services.indexOf(b)
  })
}

function keysEqual(a: AllocationKey, b: AllocationKey): boolean {
  return (
    a.worktreeRoot === b.worktreeRoot &&
    a.namespace === b.namespace &&
    a.gitCommonDir === b.gitCommonDir
  )
}

function buildPortsMap(
  orderedServices: ServiceSpec[],
  candidate: number,
): Record<string, number> {
  const ports: Record<string, number> = {}
  for (const [i, service] of orderedServices.entries()) {
    ports[service.name] = candidate + i
  }
  return ports
}

async function tryReuseExisting(
  handle: WithRegistryHandle,
  key: AllocationKey,
): Promise<AllocationResult | null> {
  const existing = handle.entries.find((e) => keysEqual(e.key, key))
  if (existing === undefined) {
    return null
  }
  for (const port of Object.values(existing.ports)) {
    const probeResult = await probePort(port)
    if (probeResult === 'taken') {
      handle.remove(key)
      return null
    }
  }
  handle.touch(key)
  const touched = handle.entries.find((e) => keysEqual(e.key, key))
  return { allocation: touched ?? existing, reused: true }
}

async function allocateFreshBlock(
  handle: WithRegistryHandle,
  key: AllocationKey,
  orderedServices: ServiceSpec[],
  range: PoolRange,
): Promise<Result<AllocationResult, PortweaveError>> {
  const occupied = Array.from(
    new Set(handle.entries.flatMap((e) => Object.values(e.ports))),
  ).sort((a, b) => a - b)

  const externallyOccupied: number[] = []

  for (let retries = 0; retries < MAX_PROBE_RETRIES; retries++) {
    const allOccupied = [...occupied, ...externallyOccupied].sort(
      (a, b) => a - b,
    )
    const candidate = findFreeBlock(allOccupied, orderedServices.length, range)
    if (candidate === null) {
      return err(
        new PortweaveError(
          PW_ERROR_CODES.ALLOCATION_EXHAUSTED,
          'Port pool exhausted: no contiguous block available in registry',
        ),
      )
    }

    const probeResult = await probeBlock(candidate, orderedServices.length)
    if (probeResult.allFree) {
      const ports = buildPortsMap(orderedServices, candidate)
      const entry: RegistryEntry = {
        key,
        lastUsedAt: new Date().toISOString(),
        namespace: key.namespace,
        ports,
      }
      handle.upsert(entry)
      return ok({ allocation: entry, reused: false })
    }

    // A port in the candidate block is externally taken — skip past it
    externallyOccupied.push(probeResult.firstTakenPort)
  }

  return err(
    new PortweaveError(
      PW_ERROR_CODES.ALLOCATION_EXHAUSTED,
      'Port pool exhausted: too many externally-bound ports prevented allocation',
    ),
  )
}

export async function allocate(
  key: AllocationKey,
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<AllocationResult, PortweaveError>> {
  const range = resolvePoolRange(env)
  const orderedServices = orderServicesForAllocation(config)

  // Wrap the inner Result in a container so withRegistry<T> doesn't
  // double-wrap our error path. The outer Result carries lock/IO errors;
  // the inner carries allocator-level errors.
  const outer = await withRegistry(
    async (handle): Promise<Result<AllocationResult, PortweaveError>> => {
      const reused = await tryReuseExisting(handle, key)
      if (reused !== null) {
        return ok(reused)
      }
      return allocateFreshBlock(handle, key, orderedServices, range)
    },
    env,
  )

  if (!outer.ok) {
    return outer
  }
  return outer.value
}
