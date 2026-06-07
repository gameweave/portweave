import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { withRegistry } from '../../registry/storage.ts'
import type { AllocationKey, RegistryEntry } from '../../registry/types.ts'
import { resolveAllocationKey } from '../../worktree/key.ts'
import { injectCsrfMeta } from '../post-handlers.ts'
import type { PanelSecurity } from '../security.ts'
import { type RunningPanelServer, startPanelServer } from '../server.ts'
import type { TriageProvider, WorktreeTriage } from '../triage-cache.ts'
import type { PanelPrStatus } from '../types.ts'

// ---------------------------------------------------------------------------
// Snapshot shapes (mirror src/panel/types.ts) — for typed body assertions
// ---------------------------------------------------------------------------

interface PanelWorktreeBody {
  branch: null | string
  degraded: boolean
  degradedReason: null | string
  diskSizeBytes: null | number
  kind: 'linked' | 'main'
  lastUsedAt: string
  namespace: string
  prStatus: null | PanelPrStatus
  removeCommand: string
  safeToPrune: boolean
  workingTreeClean: boolean | null
  worktreeRoot: string
}

interface PanelProjectBody {
  gitCommonDir: null | string
  label: string
  worktrees: PanelWorktreeBody[]
}

interface PanelSnapshotBody {
  generatedAt: string
  launchSupported: boolean
  projects: PanelProjectBody[]
  prStatusAvailable: boolean
}

// Serialized snapshot key order = enrich's object-literal insertion order
// (ASCII/perfectionist sort): generatedAt, launchSupported, projects,
// prStatusAvailable. JSON preserves insertion order for string keys.
const SNAPSHOT_KEYS = [
  'generatedAt',
  'launchSupported',
  'projects',
  'prStatusAvailable',
] as const

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

// A fixed triage payload — no real gh/git/du. Keeps every server test fast,
// deterministic, and (crucially) non-writing: the GET path stays a pure read.
const STUB_TRIAGE: WorktreeTriage = {
  branch: 'feature/panel-branch-name',
  diskSizeBytes: null,
  kind: 'linked',
  prStatus: null,
  workingTreeClean: true,
}

// Records each triageFor call's force flag so the ?refresh=1 path can be
// asserted to thread force=true into the server's own provider.
interface TrackingTriage extends TriageProvider {
  readonly forceCalls: boolean[]
}

function stubTriage(prStatusAvailable = false): TrackingTriage {
  const forceCalls: boolean[] = []
  return {
    forceCalls,
    prStatusAvailable,
    triageFor: (_worktreeRoot: string, force = false) => {
      forceCalls.push(force)
      return Promise.resolve(STUB_TRIAGE)
    },
  }
}

const STUB_CSRF_TOKEN = 'test-csrf-token-deadbeef'

// A flippable security stub: `allow` toggles authorizeMutation so a test can
// exercise both the authorized path and the 403 gate without a real token.
interface StubSecurity extends PanelSecurity {
  allow: boolean
}

function stubSecurity(allow = true): StubSecurity {
  const security: StubSecurity = {
    allow,
    authorizeMutation: () => security.allow,
    csrfToken: STUB_CSRF_TOKEN,
  }
  return security
}

interface BootOverrides {
  readonly security?: PanelSecurity
  readonly triage?: TriageProvider
}

async function startOk(
  serverEnv: NodeJS.ProcessEnv,
  controllers: AbortController[],
  overrides: BootOverrides = {},
): Promise<RunningPanelServer> {
  const ac = new AbortController()
  controllers.push(ac)
  const result = await startPanelServer({
    env: serverEnv,
    port: 0,
    security: overrides.security ?? stubSecurity(),
    signal: ac.signal,
    triage: overrides.triage ?? stubTriage(),
  })
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

function postJson(
  server: RunningPanelServer,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl(server)}${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

interface ErrorBody {
  code: string
  error: string
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

async function boot(
  overrides: BootOverrides = {},
): Promise<RunningPanelServer> {
  const server = await startOk(env, controllers, overrides)
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
  it('returns application/json with the full top-level snapshot keys', async () => {
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
      expect(Object.keys(body)).toEqual(SNAPSHOT_KEYS)
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
    expect(Object.keys(body)).toEqual(SNAPSHOT_KEYS)
    expect(body.projects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 14b: GET /api/allocations?refresh=1 forces a recompute on the server's
// own provider (threads force=true), rather than building a throwaway one.
// ---------------------------------------------------------------------------
describe('GET /api/allocations?refresh=1', () => {
  it('serves the injected provider and threads force=true into triageFor', async () => {
    // A real worktree dir so enrich reaches the triage provider for it.
    const dir = await mkdtemp(join(tmpdir(), 'pw-panel-srv-refresh-'))
    try {
      await writeFile(join(dir, 'portweave.config.json'), HEALTHY_CONFIG)
      await seedEntry(
        env,
        makeEntry(syntheticKey(dir, '/repo-refresh/.git', 'main'), {
          api: 41500,
        }),
      )

      // Inject our own tracking stub so we can read its force-call log and
      // confirm the SAME instance (not a throwaway) served the request.
      const triage = stubTriage(true)
      const server = await boot({ triage })

      const res = await fetch(`${snapshotUrl(server)}?refresh=1`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as PanelSnapshotBody
      // The stub reports prStatusAvailable: true — proves the stub served it.
      expect(body.prStatusAvailable).toBe(true)
      // The single triage lookup for this entry was forced.
      expect(triage.forceCalls).toEqual([true])
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })

  it('does not force on an ordinary (no-refresh) GET', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pw-panel-srv-norefresh-'))
    try {
      await writeFile(join(dir, 'portweave.config.json'), HEALTHY_CONFIG)
      await seedEntry(
        env,
        makeEntry(syntheticKey(dir, '/repo-norefresh/.git', 'main'), {
          api: 41600,
        }),
      )

      const triage = stubTriage(true)
      const server = await boot({ triage })

      const res = await fetch(snapshotUrl(server))
      expect(res.status).toBe(200)
      expect(triage.forceCalls).toEqual([false])
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
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
// Test 17: routing matrix — GET-only routes 405 on POST, unknown paths 404,
// unsupported methods 405. (POST /api/prune and /api/open are exercised below.)
// ---------------------------------------------------------------------------
describe('routing — matrix', () => {
  it('405s POST on the GET-only allocations route and 404s unknown GET paths', async () => {
    const server = await boot()
    const base = baseUrl(server)

    // /api/allocations is GET-only: POST is a method mismatch (405), not a 404.
    const post = await fetch(`${base}/api/allocations`, { method: 'POST' })
    expect(post.status).toBe(405)

    const unknown = await fetch(`${base}/nope`)
    expect(unknown.status).toBe(404)
  })

  it('404s an unknown POST path and 405s an unsupported method', async () => {
    const server = await boot()
    const base = baseUrl(server)

    // An unknown POST route falls through the mutating-route dispatcher → 404.
    const unknownPost = await fetch(`${base}/api/nope`, { method: 'POST' })
    expect(unknownPost.status).toBe(404)

    // A method that is neither GET nor POST → 405.
    const put = await fetch(`${base}/api/allocations`, { method: 'PUT' })
    expect(put.status).toBe(405)
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

// ---------------------------------------------------------------------------
// Test 19: POST /api/prune — the panel's first registry write
// ---------------------------------------------------------------------------
describe('POST /api/prune', () => {
  it('removes the targeted entry (others intact) when authorized and confirmed', async () => {
    // Two valid (real-dir) siblings so withRegistry's stale-prune-on-write
    // can't drop the one we expect to keep.
    const dirA = await mkdtemp(join(tmpdir(), 'pw-prune-a-'))
    const dirB = await mkdtemp(join(tmpdir(), 'pw-prune-b-'))
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirA, '/repo-a/.git', 'main'), { api: 44000 }),
      )
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirB, '/repo-b/.git', 'feat'), { api: 44001 }),
      )

      const server = await boot({ security: stubSecurity(true) })
      const res = await postJson(server, '/api/prune', {
        confirm: true,
        gitCommonDir: '/repo-a/.git',
        namespace: 'main',
        worktreeRoot: dirA,
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ removed: true })

      // The targeted entry is gone; the valid sibling remains.
      const after = await readRegistryEntries(configDir)
      expect(after.map((e) => e.key.worktreeRoot)).toEqual([dirB])
    } finally {
      await rm(dirA, { force: true, recursive: true })
      await rm(dirB, { force: true, recursive: true })
    }
  })

  it('returns 403 PANEL_REQUEST_FORBIDDEN when authorizeMutation is false', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'pw-prune-403-'))
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirA, '/repo-a/.git', 'main'), { api: 44100 }),
      )

      const server = await boot({ security: stubSecurity(false) })
      const res = await postJson(server, '/api/prune', {
        confirm: true,
        gitCommonDir: '/repo-a/.git',
        namespace: 'main',
        worktreeRoot: dirA,
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).code).toBe(
        PW_ERROR_CODES.PANEL_REQUEST_FORBIDDEN,
      )

      // The 403 must short-circuit before any write.
      const after = await readRegistryEntries(configDir)
      expect(after.map((e) => e.key.worktreeRoot)).toEqual([dirA])
    } finally {
      await rm(dirA, { force: true, recursive: true })
    }
  })

  it('returns 400 when confirm is missing, leaving the registry untouched', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'pw-prune-400-'))
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirA, '/repo-a/.git', 'main'), { api: 44200 }),
      )

      const server = await boot({ security: stubSecurity(true) })
      const res = await postJson(server, '/api/prune', {
        gitCommonDir: '/repo-a/.git',
        namespace: 'main',
        worktreeRoot: dirA,
      })

      expect(res.status).toBe(400)

      const after = await readRegistryEntries(configDir)
      expect(after.map((e) => e.key.worktreeRoot)).toEqual([dirA])
    } finally {
      await rm(dirA, { force: true, recursive: true })
    }
  })

  it('returns 400 for an authorized request with a non-JSON body', async () => {
    const server = await boot({ security: stubSecurity(true) })
    const res = await fetch(`${baseUrl(server)}/api/prune`, {
      body: 'not json at all',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for an authorized+confirmed body with a non-string worktreeRoot', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'pw-prune-badroot-'))
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirA, '/repo-a/.git', 'main'), { api: 44300 }),
      )

      const server = await boot({ security: stubSecurity(true) })
      // confirm passes the first gate; worktreeRoot is the wrong type, so the
      // typeof guard 400s before any registry write (the entry stays intact).
      const res = await postJson(server, '/api/prune', {
        confirm: true,
        gitCommonDir: '/repo-a/.git',
        namespace: 'main',
        worktreeRoot: 42,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error).toBe('invalid request body')

      const after = await readRegistryEntries(configDir)
      expect(after.map((e) => e.key.worktreeRoot)).toEqual([dirA])
    } finally {
      await rm(dirA, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// startPanelServer — fall-forward range exhausted
// ---------------------------------------------------------------------------
describe('startPanelServer — no free port', () => {
  it('returns CLI_PANEL_PORT_IN_USE when every candidate port is taken', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    const { port } = blocker.address() as AddressInfo
    try {
      // portAttempts: 1 → only the occupied port is tried, so the range is
      // immediately exhausted and the fall-forward gives up.
      const result = await startPanelServer({ env, port, portAttempts: 1 })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe(PW_ERROR_CODES.CLI_PANEL_PORT_IN_USE)
      }
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => {
          resolve()
        })
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 20: POST /api/open — gated quick-action launch with path validation
// ---------------------------------------------------------------------------
describe('POST /api/open', () => {
  it('launches at a known allocation root when authorized', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'pw-open-ok-'))
    // launchAt reads process.env.PORTWEAVE_EDITOR; point it at a no-op binary so
    // an authorized open spawns `true` (exits immediately, no editor window)
    // instead of really launching an editor on a dev macOS machine.
    const priorEditor = process.env.PORTWEAVE_EDITOR
    process.env.PORTWEAVE_EDITOR = 'true'
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(dirA, '/repo-a/.git', 'main'), { api: 45000 }),
      )

      const server = await boot({ security: stubSecurity(true) })
      const res = await postJson(server, '/api/open', {
        target: 'editor',
        worktreeRoot: dirA,
      })

      // Path is allowed → the route reaches launchAt and returns its
      // LaunchResult (graceful no-op off-macOS); the gate + path validation is
      // what this asserts, not the platform-specific spawn.
      expect(res.status).toBe(200)
      const body = (await res.json()) as { launched: boolean }
      expect(typeof body.launched).toBe('boolean')
    } finally {
      if (priorEditor === undefined) {
        delete process.env.PORTWEAVE_EDITOR
      } else {
        process.env.PORTWEAVE_EDITOR = priorEditor
      }
      await rm(dirA, { force: true, recursive: true })
    }
  })

  it('returns 403 PANEL_PATH_NOT_ALLOWED for a path that is not an allocation root', async () => {
    const allocated = await mkdtemp(join(tmpdir(), 'pw-open-alloc-'))
    const stranger = await mkdtemp(join(tmpdir(), 'pw-open-stranger-'))
    try {
      await seedEntry(
        env,
        makeEntry(syntheticKey(allocated, '/repo-a/.git', 'main'), {
          api: 45100,
        }),
      )

      const server = await boot({ security: stubSecurity(true) })
      // stranger exists on disk but is not a registry allocation root.
      const res = await postJson(server, '/api/open', {
        target: 'terminal',
        worktreeRoot: stranger,
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).code).toBe(
        PW_ERROR_CODES.PANEL_PATH_NOT_ALLOWED,
      )
    } finally {
      await rm(allocated, { force: true, recursive: true })
      await rm(stranger, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 21: CSRF token injection into the served index.html
// ---------------------------------------------------------------------------
const EXPECTED_META = `<meta name="pw-csrf" content="${STUB_CSRF_TOKEN}">`

describe('CSRF meta injection', () => {
  it('injects a pw-csrf meta tag immediately before </head>', () => {
    const html = '<html><head><title>x</title></head><body></body></html>'
    const out = injectCsrfMeta(html, STUB_CSRF_TOKEN)

    expect(out).toContain(EXPECTED_META)
    expect(out).toContain(`content="${STUB_CSRF_TOKEN}"></head>`)
  })

  it('prepends the tag when the HTML has no </head>', () => {
    const out = injectCsrfMeta('<body>only</body>', STUB_CSRF_TOKEN)
    expect(out.startsWith(EXPECTED_META)).toBe(true)
    expect(out.endsWith('<body>only</body>')).toBe(true)
  })
})
