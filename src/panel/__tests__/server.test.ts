import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withRegistry } from '../../registry/storage.ts'
import type { AllocationKey, RegistryEntry } from '../../registry/types.ts'
import { resolveAllocationKey } from '../../worktree/key.ts'
import { type RunningPanelServer, startPanelServer } from '../server.ts'

// ---------------------------------------------------------------------------
// Snapshot shapes (mirror src/panel/types.ts) — for typed body assertions
// ---------------------------------------------------------------------------

interface PanelWorktreeBody {
  degraded: boolean
  degradedReason: null | string
  namespace: string
  worktreeRoot: string
}

interface PanelProjectBody {
  gitCommonDir: null | string
  label: string
  worktrees: PanelWorktreeBody[]
}

interface PanelSnapshotBody {
  generatedAt: string
  projects: PanelProjectBody[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEALTHY_CONFIG = JSON.stringify({
  services: {
    api: { envVar: 'API_PORT' },
    web: { envVar: 'WEB_PORT' },
  },
})

async function seedEntry(
  env: NodeJS.ProcessEnv,
  entry: RegistryEntry,
): Promise<void> {
  const result = await withRegistry((handle) => {
    handle.upsert(entry)
  }, env)
  if (!result.ok) {
    throw new Error(`test setup: seed failed: ${result.error.message}`)
  }
}

async function readRegistryEntries(
  configDir: string,
): Promise<RegistryEntry[]> {
  const registryFile = join(configDir, 'portweave', 'registry.json')
  const raw = await readFile(registryFile, 'utf8')
  return (JSON.parse(raw) as { entries: RegistryEntry[] }).entries
}

function syntheticKey(
  worktreeRoot: string,
  gitCommonDir: null | string,
  namespace: string,
): AllocationKey {
  return { gitCommonDir, namespace, offsetOverride: null, worktreeRoot }
}

function makeEntry(
  key: AllocationKey,
  ports: Record<string, number>,
  lastUsedAt = '2026-01-01T00:00:00.000Z',
): RegistryEntry {
  return { key, lastUsedAt, namespace: key.namespace, ports }
}

async function startOk(
  env: NodeJS.ProcessEnv,
  controllers: AbortController[],
): Promise<RunningPanelServer> {
  const ac = new AbortController()
  controllers.push(ac)
  const result = await startPanelServer({ env, port: 0, signal: ac.signal })
  if (!result.ok) {
    throw new Error(`test setup: startPanelServer failed: ${result.error.message}`)
  }
  return result.value
}

function baseUrl(server: RunningPanelServer): string {
  return `http://127.0.0.1:${String(server.port)}`
}

function snapshotUrl(server: RunningPanelServer): string {
  return `${baseUrl(server)}/api/allocations`
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let configDir: string
let env: NodeJS.ProcessEnv
let controllers: AbortController[]
let running: RunningPanelServer[]

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-panel-srv-cfg-'))
  env = { XDG_CONFIG_HOME: configDir }
  controllers = []
  running = []
})

afterEach(async () => {
  for (const ac of controllers) {
    ac.abort()
  }
  await Promise.all(running.map((server) => server.closed))
  await rm(configDir, { force: true, recursive: true })
})

async function boot(): Promise<RunningPanelServer> {
  const server = await startOk(env, controllers)
  running.push(server)
  return server
}

// ---------------------------------------------------------------------------
// Test 12: boots on 127.0.0.1
// ---------------------------------------------------------------------------
describe('startPanelServer — binding', () => {
  it('boots on 127.0.0.1 with an ephemeral port and serves over loopback', async () => {
    const server = await boot()

    expect(server.port).toBeGreaterThan(0)

    // A successful loopback fetch proves the socket is bound on 127.0.0.1.
    const res = await fetch(snapshotUrl(server))
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Test 13: GET /api/allocations shape
// ---------------------------------------------------------------------------
describe('GET /api/allocations — shape', () => {
  it('returns application/json with top-level keys exactly generatedAt, projects', async () => {
    // Real worktree dirs so the seed's prune-on-write keeps both entries
    // (withRegistry drops deleted-dir entries across separate seed calls).
    const dirA = await mkdtemp(join(tmpdir(), 'pw-panel-srv-a-'))
    const dirB = await mkdtemp(join(tmpdir(), 'pw-panel-srv-b-'))
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirA, '/repo-a/.git', 'main'), {
          api: 41000,
        }),
      )
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirB, '/repo-b/.git', 'main'), {
          api: 41001,
        }),
      )

      const server = await boot()
      const res = await fetch(snapshotUrl(server))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')

      const body = (await res.json()) as PanelSnapshotBody
      expect(Object.keys(body)).toEqual(['generatedAt', 'projects'])
      expect(typeof body.generatedAt).toBe('string')
      // Two distinct gitCommonDirs → two projects.
      expect(body.projects).toHaveLength(2)
      expect(body.projects.map((p) => p.gitCommonDir).sort()).toEqual([
        '/repo-a/.git',
        '/repo-b/.git',
      ])
    } finally {
      await rm(dirA, { force: true, recursive: true })
      await rm(dirB, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 14: empty registry → projects: []
// ---------------------------------------------------------------------------
describe('GET /api/allocations — empty registry', () => {
  it('returns 200 and an empty projects array', async () => {
    const server = await boot()
    const res = await fetch(snapshotUrl(server))

    expect(res.status).toBe(200)
    const body = (await res.json()) as PanelSnapshotBody
    expect(Object.keys(body)).toEqual(['generatedAt', 'projects'])
    expect(body.projects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 15: mixed healthy + degraded over HTTP
// ---------------------------------------------------------------------------
describe('GET /api/allocations — mixed healthy + degraded', () => {
  it('serves a healthy worktree and a deleted-directory worktree together', async () => {
    // Healthy: a real tempdir worktree with a matching config.
    const healthyDir = await mkdtemp(join(tmpdir(), 'pw-panel-srv-wt-'))
    try {
      await writeFile(join(healthyDir, 'portweave.config.json'), HEALTHY_CONFIG)
      const keyResult = resolveAllocationKey(healthyDir)
      if (!keyResult.ok) {
        throw new Error(
          `test setup: resolveAllocationKey failed: ${keyResult.error.message}`,
        )
      }
      await seedEntry(
        env,
        makeEntry(keyResult.value, { api: 42000, web: 42001 }),
      )

      // Degraded: a registry entry whose worktreeRoot does not exist on disk.
      const goneDir = join(tmpdir(), 'pw-panel-srv-gone-does-not-exist')
      await seedEntry(
        env,
        makeEntry(syntheticKey(goneDir, '/gone-repo/.git', 'feature-x'), {
          api: 42100,
        }),
      )

      const server = await boot()
      const res = await fetch(snapshotUrl(server))
      expect(res.status).toBe(200)

      const body = (await res.json()) as PanelSnapshotBody
      const worktrees = body.projects.flatMap((p) => p.worktrees)
      expect(worktrees).toHaveLength(2)

      const healthy = worktrees.find((w) => w.worktreeRoot === healthyDir)
      const degraded = worktrees.find((w) => w.worktreeRoot === goneDir)

      expect(healthy?.degraded).toBe(false)
      expect(healthy?.degradedReason).toBeNull()

      expect(degraded?.degraded).toBe(true)
      expect(degraded?.degradedReason).toBe('directory deleted')
    } finally {
      await rm(healthyDir, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 16: read-only over HTTP
// ---------------------------------------------------------------------------
describe('GET /api/allocations — read-only', () => {
  it('leaves the registry byte-identical after repeated requests, even with a stale entry', async () => {
    // Seed a healthy entry and a deleted-dir entry. Both dirs exist at seed
    // time so the seed (which prunes on write) keeps them; we then delete one
    // so a stale entry is on disk. The non-pruning panel read must not rewrite
    // the file — under the old prune-on-read path the stale entry would have
    // triggered a rewrite on the first request.
    const healthyDir = await mkdtemp(join(tmpdir(), 'pw-panel-srv-ro-'))
    const goneDir = await mkdtemp(join(tmpdir(), 'pw-panel-srv-ro-gone-'))
    try {
      await writeFile(join(healthyDir, 'portweave.config.json'), HEALTHY_CONFIG)
      await seedEntry(
        env,
        makeEntry(syntheticKey(healthyDir, '/ro-a/.git', 'main'), {
          api: 43000,
        }),
      )
      await seedEntry(
        env,
        makeEntry(syntheticKey(goneDir, '/ro-b/.git', 'main'), {
          api: 43001,
        }),
      )
      await rm(goneDir, { force: true, recursive: true })

      const registryFile = join(configDir, 'portweave', 'registry.json')
      const beforeBytes = await readFile(registryFile, 'utf8')
      const before = await readRegistryEntries(configDir)

      const server = await boot()
      for (let i = 0; i < 3; i++) {
        const res = await fetch(snapshotUrl(server))
        expect(res.status).toBe(200)
        await res.json()
      }

      const afterBytes = await readFile(registryFile, 'utf8')
      const after = await readRegistryEntries(configDir)
      expect(afterBytes).toBe(beforeBytes)
      expect(after).toEqual(before)
      // The stale entry must still be present (not pruned away by the read).
      expect(after.map((e) => e.key.worktreeRoot).sort()).toEqual(
        [healthyDir, goneDir].sort(),
      )
    } finally {
      await rm(healthyDir, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 17: 405 on non-GET, 404 on unknown path
// ---------------------------------------------------------------------------
describe('routing — 405 / 404', () => {
  it('rejects POST with 405 and unknown GET paths with 404', async () => {
    const server = await boot()
    const base = baseUrl(server)

    const post = await fetch(`${base}/api/allocations`, { method: 'POST' })
    expect(post.status).toBe(405)

    const unknown = await fetch(`${base}/nope`)
    expect(unknown.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Test 18: static fallback when the UI is unbuilt
// ---------------------------------------------------------------------------
describe('static serving — unbuilt UI', () => {
  it('returns 503 for GET / while GET /api/allocations still 200s', async () => {
    // Tests run against source (no dist/panel/index.html), so the UI is unbuilt.
    const server = await boot()
    const base = baseUrl(server)

    const root = await fetch(`${base}/`)
    expect(root.status).toBe(503)
    expect(await root.text()).toContain('panel UI not built')

    const api = await fetch(`${base}/api/allocations`)
    expect(api.status).toBe(200)
  })
})
