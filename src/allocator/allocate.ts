import type { Config, ServiceSpec } from '../config/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { withRegistry, type WithRegistryHandle } from '../registry/storage.ts'
import type { AllocationKey, RegistryEntry } from '../registry/types.ts'
import {
  noCandidateError,
  pickCandidate,
  type Placement,
  resolvePlacement,
} from './placement.ts'
import { probeBlock } from './probe.ts'

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

/**
 * Assign `candidate`, `candidate + 1`, ... across `orderedServices`.
 *
 * Exported because `portweave slots` enumerates every slot's ports for
 * pre-registration and must agree with what the allocator will actually hand
 * out — one definition of the service-to-offset mapping, not two.
 */
export function buildPortsMap(
  orderedServices: ServiceSpec[],
  candidate: number,
): Record<string, number> {
  const ports: Record<string, number> = {}
  for (const [i, service] of orderedServices.entries()) {
    ports[service.name] = candidate + i
  }
  return ports
}

function tryReuseExisting(
  handle: WithRegistryHandle,
  key: AllocationKey,
  orderedServices: ServiceSpec[],
): AllocationResult | null {
  const existing = handle.entries.find((e) => keysEqual(e.key, key))
  if (existing === undefined) {
    return null
  }
  // Reconcile against the current config before reusing. If the config now
  // declares a service this block predates — the common case being a service
  // added to portweave.config.json after the block was first allocated — the
  // cached block is too small. Returning it as-is would make buildEnvMap throw
  // ENV_BUILD_INVALID (PW0501, "config/allocation drift") on the port the new
  // service has no slot for, breaking every command in that worktree until a
  // manual `portweave prune`. Fall through to a fresh, larger allocation
  // instead. This fires only on additive growth: an unchanged service set — or
  // a config that *dropped* a service (the block is a superset; buildEnvMap
  // only reads config services) — still hits the unconditional reuse below, so
  // the port-stability guarantee documented there is preserved for the hot path.
  const coversConfig = orderedServices.every((service) =>
    Object.hasOwn(existing.ports, service.name),
  )
  if (!coversConfig) {
    return null
  }
  // Reuse is unconditional: an existing entry for this key is returned as-is,
  // without probing its ports. A port bound by this allocation's own services
  // is the normal runtime state, not a conflict — and a loopback probe cannot
  // tell "my own server" from "an external squatter" anyway. Re-rolling on the
  // former breaks idempotency for config consumers that read ports()/env()
  // after sibling services are already up. Cross-project conflicts are
  // prevented at fresh-allocation time (distinct keys get distinct blocks);
  // stale entries are handled by age-based pruning in withRegistry, not here.
  // See decision-log #37.
  handle.touch(key)
  const touched = handle.entries.find((e) => keysEqual(e.key, key))
  return { allocation: touched ?? existing, reused: true }
}

async function allocateFreshBlock(
  handle: WithRegistryHandle,
  key: AllocationKey,
  orderedServices: ServiceSpec[],
  placement: Placement,
): Promise<Result<AllocationResult, PortweaveError>> {
  const occupied = Array.from(
    new Set(handle.entries.flatMap((e) => Object.values(e.ports))),
  ).sort((a, b) => a - b)

  const externallyOccupied: number[] = []

  for (let retries = 0; retries < MAX_PROBE_RETRIES; retries++) {
    const allOccupied = [...occupied, ...externallyOccupied].sort(
      (a, b) => a - b,
    )
    const candidate = pickCandidate(
      allOccupied,
      orderedServices.length,
      placement,
    )
    if (candidate === null) {
      return err(noCandidateError(placement))
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

    // A port in the candidate block is externally taken. In first-fit mode we
    // skip past that one port; in slot mode `findFreeSlot` retires the whole
    // slot, which is what keeps slot bases on the declared stride.
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
  stderr: { write: (msg: string) => boolean } = process.stderr,
): Promise<Result<AllocationResult, PortweaveError>> {
  const placement = resolvePlacement(key, config, env, stderr)
  const orderedServices = orderServicesForAllocation(config)

  // Wrap the inner Result in a container so withRegistry<T> doesn't
  // double-wrap our error path. The outer Result carries lock/IO errors;
  // the inner carries allocator-level errors.
  const outer = await withRegistry(
    async (handle): Promise<Result<AllocationResult, PortweaveError>> => {
      const reused = tryReuseExisting(handle, key, orderedServices)
      if (reused !== null) {
        return ok(reused)
      }
      return allocateFreshBlock(handle, key, orderedServices, placement)
    },
    env,
  )

  if (!outer.ok) {
    return outer
  }
  return outer.value
}
