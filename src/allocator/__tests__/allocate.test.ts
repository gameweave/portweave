import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocate, MAX_PROBE_RETRIES } from '../allocate.ts'
import { PW_ERROR_CODES } from '../../errors.ts'
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
