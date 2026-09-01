import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocate, MAX_PROBE_RETRIES } from '../allocate.ts'
import type { PoolSpec } from '../../config/index.ts'
import { PW_ERROR_CODES } from '../../errors.ts'
import { MAIN_NAMESPACE } from '../../worktree/namespace.ts'
import {
  addWorktreeDir,
  bindServerOnPort,
  cleanupTempDirs,
  makeAllocationKey,
  makeAllocatorConfig,
  makeTempDirs,
  type TempDirs,
} from './_helpers.ts'

let dirs: TempDirs

beforeEach(async () => {
  dirs = await makeTempDirs()
})

afterEach(async () => {
  await cleanupTempDirs(dirs)
})

function env(): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: dirs.configDir }
}

describe('allocate — fresh allocation', () => {
  it('allocates contiguous ports for a 3-service config', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
      { envVar: 'WS_PORT', name: 'ws' },
    ])
    const key = makeAllocationKey(wt)
    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const { allocation, reused } = result.value
    expect(reused).toBe(false)
    const ports = Object.values(allocation.ports)
    expect(ports).toHaveLength(3)
    // Ports must be contiguous
    const sorted = [...ports].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1] + 1)
    }
    // Ports within pool range
    expect(sorted[0]).toBeGreaterThanOrEqual(30000)
    expect(sorted[sorted.length - 1]).toBeLessThan(60000)
  })

  it('maps service names to their ports in allocation order', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
    ])
    const key = makeAllocationKey(wt)
    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const { allocation } = result.value
    expect(Object.keys(allocation.ports)).toContain('api')
    expect(Object.keys(allocation.ports)).toContain('vite')
    // api is first, vite is second — should be contiguous
    const apiPort = allocation.ports.api
    const vitePort = allocation.ports.vite
    expect(vitePort).toBe(apiPort + 1)
  })

  it('records namespace and key on the allocation', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }])
    const key = makeAllocationKey(wt, { namespace: 'my-namespace' })
    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.allocation.namespace).toBe('my-namespace')
    expect(result.value.allocation.key.worktreeRoot).toBe(wt)
  })
})

describe('allocate — stickiness (reuse path)', () => {
  it('returns the same ports on second call for the same key (reused: true)', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
    ])
    const key = makeAllocationKey(wt)

    const first = await allocate(key, config, env())
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    const second = await allocate(key, config, env())
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    expect(second.value.reused).toBe(true)
    expect(second.value.allocation.ports).toEqual(first.value.allocation.ports)
  })
})

describe('allocate — config growth reconcile (drift heal)', () => {
  // Regression: adding a service to the config after a block was first
  // allocated must NOT return the stale (too-small) block — that block has no
  // port for the new service, so buildEnvMap would throw PW0501 and every
  // command in the worktree would fail until a manual prune. allocate() must
  // reallocate a fresh, larger block that covers the new service instead.
  it('reallocates a fresh block when the config gains a service the cached block lacks', async () => {
    const wt = await addWorktreeDir(dirs)
    const key = makeAllocationKey(wt)

    const before = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
    ])
    const first = await allocate(key, before, env())
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    expect(first.value.reused).toBe(false)

    // A new service ("minio") is added to the config for the same worktree.
    const after = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
      { envVar: 'MINIO_PORT', name: 'minio' },
    ])
    const second = await allocate(key, after, env())
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    // Not a stale reuse — a fresh block sized for all three services.
    expect(second.value.reused).toBe(false)
    const ports = second.value.allocation.ports
    expect(Object.hasOwn(ports, 'minio')).toBe(true)
    expect(Object.keys(ports)).toHaveLength(3)
    const sorted = Object.values(ports).sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1] + 1)
    }
  })

  it('reuses the same block (stable ports) when the config drops a service', async () => {
    const wt = await addWorktreeDir(dirs)
    const key = makeAllocationKey(wt)

    const before = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
      { envVar: 'WS_PORT', name: 'ws' },
    ])
    const first = await allocate(key, before, env())
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    // The cached block is now a superset of the config's services. buildEnvMap
    // only reads config services, so the extra port is harmless — reuse must
    // stay sticky rather than needlessly re-rolling the ports.
    const after = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
    ])
    const second = await allocate(key, after, env())
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    expect(second.value.reused).toBe(true)
    expect(second.value.allocation.ports).toEqual(first.value.allocation.ports)
  })
})

describe('allocate — idempotent reuse while allocated ports are bound (regression)', () => {
  // Regression: a second allocate() for the same key must return the EXISTING
  // block even when its ports are currently bound — a bound port for an
  // allocation already owned by this key is the normal runtime state (the
  // caller's own services are up), not a conflict. The reuse path must not
  // probe-and-evict. See decision-log #37.
  const config = makeAllocatorConfig([
    { envVar: 'API_PORT', name: 'api' },
    { envVar: 'VITE_PORT', name: 'vite' },
    { envVar: 'WS_PORT', name: 'ws' },
  ])

  interface BoundServer {
    close: () => Promise<void>
  }

  async function expectReuseStableWhileBound(
    bind: (allocatedPorts: number[]) => Promise<BoundServer[]>,
  ): Promise<void> {
    const key = makeAllocationKey(await addWorktreeDir(dirs))
    const first = await allocate(key, config, env())
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const allocated = first.value.allocation.ports
    const servers = await bind(Object.values(allocated))
    try {
      const second = await allocate(key, config, env())
      expect(second.ok && second.value.reused).toBe(true)
      const reusedPorts = second.ok ? second.value.allocation.ports : null
      expect(reusedPorts).toEqual(allocated)
    } finally {
      await Promise.all(servers.map((server) => server.close()))
    }
  }

  it('stays on the same block when an allocated port is bound on 127.0.0.1', () =>
    expectReuseStableWhileBound((ports) =>
      Promise.all([bindServerOnPort(ports[0])]),
    ))

  // 0.0.0.0 (the common bind-all default) also occupies the loopback port on
  // most platforms, so the old probe-and-evict could reallocate here too.
  it('stays on the same block when an allocated port is bound on 0.0.0.0', () =>
    expectReuseStableWhileBound((ports) =>
      Promise.all([bindServerOnPort(ports[0], '0.0.0.0')]),
    ))

  it('stays on the same block when every allocated port is bound', () =>
    expectReuseStableWhileBound((ports) =>
      Promise.all(ports.map((port) => bindServerOnPort(port))),
    ))
})

describe('allocate — skip-on-probe-fail (fresh path)', () => {
  it('skips externally-bound ports and finds the next free block', async () => {
    // Use a tight custom pool range so we can control which port is taken
    const poolRange = '51100-51110'
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }])
    const key = makeAllocationKey(wt)

    // Bind the first port in the range
    const server = await bindServerOnPort(51100)

    try {
      const result = await allocate(key, config, {
        PORTWEAVE_POOL_RANGE: poolRange,
        XDG_CONFIG_HOME: dirs.configDir,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }

      expect(result.value.allocation.ports.api).not.toBe(51100)
      expect(result.value.allocation.ports.api).toBeGreaterThanOrEqual(51101)
    } finally {
      await server.close()
    }
  })
})

describe('allocate — pool exhaustion', () => {
  it('returns ALLOCATION_EXHAUSTED when the pool has no free block', async () => {
    // Use a pool range just large enough for 1 service
    const poolRange = '51500-51501'
    const config1 = makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }])
    const config2 = makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }])

    const wt1 = await addWorktreeDir(dirs)
    const wt2 = await addWorktreeDir(dirs)
    const key1 = makeAllocationKey(wt1, { namespace: 'wt1' })
    const key2 = makeAllocationKey(wt2, { namespace: 'wt2' })
    const testEnv = {
      PORTWEAVE_POOL_RANGE: poolRange,
      XDG_CONFIG_HOME: dirs.configDir,
    }

    // First allocation takes the only slot
    const first = await allocate(key1, config1, testEnv)
    expect(first.ok).toBe(true)

    // Second allocation cannot fit
    const second = await allocate(key2, config2, testEnv)
    expect(second.ok).toBe(false)
    if (second.ok) {
      return
    }
    expect(second.error.code).toBe(PW_ERROR_CODES.ALLOCATION_EXHAUSTED)
  })
})

describe('allocate — serialization through registry lock', () => {
  it('two sequential allocations for different keys do not overlap', async () => {
    const wt1 = await addWorktreeDir(dirs)
    const wt2 = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
    ])
    const key1 = makeAllocationKey(wt1, { namespace: 'wt1' })
    const key2 = makeAllocationKey(wt2, { namespace: 'wt2' })

    const first = await allocate(key1, config, env())
    const second = await allocate(key2, config, env())

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }

    const ports1 = new Set(Object.values(first.value.allocation.ports))
    const ports2 = new Set(Object.values(second.value.allocation.ports))
    for (const port of ports2) {
      expect(ports1.has(port)).toBe(false)
    }
  })
})

describe('allocate — group ordering in output', () => {
  it('grouped services land contiguous in the ports map', async () => {
    // kinesis and kinesis-tls are scattered but should be contiguous in output
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([
      { envVar: 'KINESIS_PORT', group: 'kinesis', name: 'kinesis' },
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'KINESIS_TLS_PORT', group: 'kinesis', name: 'kinesis-tls' },
    ])
    const key = makeAllocationKey(wt, { namespace: 'group-test' })

    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const kinesisPort = result.value.allocation.ports.kinesis
    const kinesisTlsPort = result.value.allocation.ports['kinesis-tls']
    // They should be adjacent (contiguous)
    expect(Math.abs(kinesisPort - kinesisTlsPort)).toBe(1)
  })
})

describe('allocate — offsetOverride plumbing', () => {
  it('preserves offsetOverride in the stored entry even though it does not influence search', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }])
    const key = makeAllocationKey(wt, { offsetOverride: 42 })

    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.allocation.key.offsetOverride).toBe(42)
  })
})

describe('allocate — MAX_PROBE_RETRIES constant', () => {
  it('exports MAX_PROBE_RETRIES = 100', () => {
    expect(MAX_PROBE_RETRIES).toBe(100)
  })
})

function slotPool(
  basePort: number,
  overrides: Partial<PoolSpec> = {},
): PoolSpec {
  return {
    basePort,
    mode: 'slots',
    primarySlot: 0,
    slots: 4,
    stride: 10,
    ...overrides,
  }
}

function twoServiceSlotConfig(pool: PoolSpec) {
  return makeAllocatorConfig(
    [
      { envVar: 'WEB_PORT', name: 'web' },
      { envVar: 'API_PORT', name: 'api' },
    ],
    { pool },
  )
}

describe('allocate — slot mode', () => {
  it('pins the primary worktree to the primary slot', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = twoServiceSlotConfig(slotPool(41100))
    const key = makeAllocationKey(wt, { namespace: MAIN_NAMESPACE })
    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.allocation.ports).toStrictEqual({
      api: 41101,
      web: 41100,
    })
  })

  it('gives a linked worktree the next slot, leaving the primary slot free', async () => {
    const wt = await addWorktreeDir(dirs)
    const config = twoServiceSlotConfig(slotPool(41200))
    const key = makeAllocationKey(wt, { namespace: 'feature-abc123' })
    const result = await allocate(key, config, env())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.allocation.ports).toStrictEqual({
      api: 41211,
      web: 41210,
    })
  })

  it('walks linked worktrees up the slots in stride steps', async () => {
    const config = twoServiceSlotConfig(slotPool(41300))
    const first = await allocate(
      makeAllocationKey(await addWorktreeDir(dirs), { namespace: 'wt-one' }),
      config,
      env(),
    )
    const second = await allocate(
      makeAllocationKey(await addWorktreeDir(dirs), { namespace: 'wt-two' }),
      config,
      env(),
    )
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }
    expect(first.value.allocation.ports.web).toBe(41310)
    expect(second.value.allocation.ports.web).toBe(41320)
  })

  it('retires a whole slot when one of its ports is externally bound', async () => {
    // Occupy the second port of slot 1. First-fit would slide to 41411; slot
    // mode must jump to the next slot base so the geometry stays predictable.
    const squatter = await bindServerOnPort(41411)
    try {
      const config = twoServiceSlotConfig(slotPool(41400))
      const result = await allocate(
        makeAllocationKey(await addWorktreeDir(dirs), { namespace: 'wt-x' }),
        config,
        env(),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }
      expect(result.value.allocation.ports.web).toBe(41420)
    } finally {
      await squatter.close()
    }
  })
})

describe('allocate — slot mode failures', () => {
  async function expectAllocationError(
    pool: PoolSpec,
    namespace: string,
  ): Promise<string> {
    const result = await allocate(
      makeAllocationKey(await addWorktreeDir(dirs), { namespace }),
      twoServiceSlotConfig(pool),
      env(),
    )
    if (result.ok) {
      throw new Error('expected allocation to fail')
    }
    return `${result.error.code} ${result.error.message}`
  }

  it('fails with ALLOCATION_PRIMARY_SLOT_BUSY when the pinned slot is taken', async () => {
    const squatter = await bindServerOnPort(41501)
    try {
      const failure = await expectAllocationError(
        slotPool(41500),
        MAIN_NAMESPACE,
      )
      expect(failure).toContain(PW_ERROR_CODES.ALLOCATION_PRIMARY_SLOT_BUSY)
      expect(failure).toContain('41500')
    } finally {
      await squatter.close()
    }
  })

  it('fails with ALLOCATION_EXHAUSTED once every non-primary slot is claimed', async () => {
    const pool = slotPool(41600, { slots: 2 })
    const claimed = await allocate(
      makeAllocationKey(await addWorktreeDir(dirs), { namespace: 'wt-a' }),
      twoServiceSlotConfig(pool),
      env(),
    )
    expect(claimed.ok).toBe(true)

    const failure = await expectAllocationError(pool, 'wt-b')
    expect(failure).toContain(PW_ERROR_CODES.ALLOCATION_EXHAUSTED)
    expect(failure).toContain('pool.slots')
  })

  it('ignores PORTWEAVE_POOL_RANGE and says so', async () => {
    const written: string[] = []
    const stderr = {
      write: (msg: string) => {
        written.push(msg)
        return true
      },
    }
    const result = await allocate(
      makeAllocationKey(await addWorktreeDir(dirs), {
        namespace: MAIN_NAMESPACE,
      }),
      twoServiceSlotConfig(slotPool(41700)),
      { ...env(), PORTWEAVE_POOL_RANGE: '50000-50100' },
      stderr,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.allocation.ports.web).toBe(41700)
    expect(written.join('')).toContain('PORTWEAVE_POOL_RANGE ignored')
  })

  it('leaves first-fit allocation untouched when no pool block is declared', async () => {
    const result = await allocate(
      makeAllocationKey(await addWorktreeDir(dirs), {
        namespace: MAIN_NAMESPACE,
      }),
      makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }]),
      env(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.allocation.ports.api).toBeGreaterThanOrEqual(30000)
    expect(result.value.allocation.ports.api).toBeLessThan(60000)
  })
})

describe('allocate — slot mode reconciliation', () => {
  it('re-rolls a cached block when the pool geometry moves', async () => {
    const wt = await addWorktreeDir(dirs)
    const key = makeAllocationKey(wt, { namespace: 'wt-moved' })

    const before = await allocate(
      key,
      twoServiceSlotConfig(slotPool(41800)),
      env(),
    )
    expect(before.ok).toBe(true)
    if (!before.ok) {
      return
    }
    expect(before.value.allocation.ports.web).toBe(41810)

    // Same worktree, same key — only basePort moved. Handing back 41810 would
    // leave this worktree outside the newly declared set.
    const after = await allocate(
      key,
      twoServiceSlotConfig(slotPool(41900)),
      env(),
    )
    expect(after.ok).toBe(true)
    if (!after.ok) {
      return
    }
    expect(after.value.reused).toBe(false)
    expect(after.value.allocation.ports.web).toBe(41910)
  })

  it('still reuses when the geometry is unchanged', async () => {
    const wt = await addWorktreeDir(dirs)
    const key = makeAllocationKey(wt, { namespace: 'wt-stable' })
    const config = twoServiceSlotConfig(slotPool(42000))

    const first = await allocate(key, config, env())
    const second = await allocate(key, config, env())
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }
    expect(second.value.reused).toBe(true)
    expect(second.value.allocation.ports).toStrictEqual(
      first.value.allocation.ports,
    )
  })
})
