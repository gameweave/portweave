import { rmSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withRegistry } from '../../registry/storage.ts'
import type { AllocationKey, RegistryEntry } from '../../registry/types.ts'
import { buildPanelSnapshot, type EnrichDeps } from '../enrich.ts'
import { isSafeLinkUrl } from '../links.ts'
import type { TriageProvider, WorktreeTriage } from '../triage-cache.ts'
import type { PanelLivenessStatus, PanelPrStatus } from '../types.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = '2026-01-01T00:00:00.000Z'

// A stub probe that reports every port as not-running — keeps tests
// deterministic and fast (no real sockets, no timeouts).
const allNotRunning: EnrichDeps = {
  probe: () => Promise.resolve('not-running'),
}

// A stub TriageProvider returning a fixed triage for every worktree — keeps
// tests off real gh/git/du. prStatusAvailable defaults to true here so the
// PR-bearing fixtures resolve; callers override it to assert the flag wiring.
// `forceCalls` records each call's force flag for the forceTriage passthrough.
interface TrackingTriage extends TriageProvider {
  readonly forceCalls: boolean[]
}

function stubTriage(
  triage: WorktreeTriage,
  prStatusAvailable = true,
): TrackingTriage {
  const forceCalls: boolean[] = []
  return {
    forceCalls,
    prStatusAvailable,
    triageFor: (_worktreeRoot: string, force = false) => {
      forceCalls.push(force)
      return Promise.resolve(triage)
    },
  }
}

function makeKey(overrides: Partial<AllocationKey> = {}): AllocationKey {
  return {
    gitCommonDir: '/repos/demo/.git',
    namespace: 'main',
    offsetOverride: null,
    worktreeRoot: '/repos/demo',
    ...overrides,
  }
}

function makeEntry(
  key: AllocationKey,
  ports: Record<string, number>,
  lastUsedAt = FIXED_TIME,
): RegistryEntry {
  return { key, lastUsedAt, namespace: key.namespace, ports }
}

async function seed(
  env: NodeJS.ProcessEnv,
  entries: readonly RegistryEntry[],
): Promise<void> {
  await withRegistry((handle) => {
    for (const entry of entries) {
      handle.upsert(entry)
    }
  }, env)
}

// Create a real tempdir worktree carrying a portweave.config.json so the
// healthy path (loadConfig + buildEnvMap) exercises real I/O.
async function makeWorktree(
  configBody: Record<string, unknown> | string,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pw-enrich-wt-'))
  const contents =
    typeof configBody === 'string' ? configBody : JSON.stringify(configBody)
  await writeFile(join(dir, 'portweave.config.json'), contents)
  return dir
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let configDir: string
let env: NodeJS.ProcessEnv
const cleanupDirs: string[] = []

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-enrich-cfg-'))
  env = { XDG_CONFIG_HOME: configDir }
})

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true })
  await Promise.all(
    cleanupDirs
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true })),
  )
})

async function trackedWorktree(
  configBody: Record<string, unknown> | string,
): Promise<string> {
  const dir = await makeWorktree(configBody)
  cleanupDirs.push(dir)
  return dir
}

// Seed a single entry under one project. Collapses the repeated
// seed(env, [makeEntry(makeKey({...}), ports)]) boilerplate the degraded-path
// tests share.
function seedSingle(
  gitCommonDir: null | string,
  worktreeRoot: string,
  ports: Record<string, number>,
  namespace = 'main',
): Promise<void> {
  return seed(env, [
    makeEntry(makeKey({ gitCommonDir, namespace, worktreeRoot }), ports),
  ])
}

// Assert the snapshot's first worktree is degraded with the given reason and
// raw service names. Collapses the shared degraded-path assertion block.
function expectDegraded(
  snapshot: Awaited<ReturnType<typeof buildPanelSnapshot>>,
  reason: string,
  serviceNames: readonly string[],
): void {
  const worktree = snapshot.projects[0].worktrees[0]
  expect(worktree.degraded).toBe(true)
  expect(worktree.degradedReason).toBe(reason)
  expect(worktree.services.map((s) => s.name)).toEqual(serviceNames)
}

// ---------------------------------------------------------------------------
// Test 4: Grouping + sort
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — grouping + sort', () => {
  it('groups by gitCommonDir, sorts projects by label, worktrees by namespace, services in config order', async () => {
    // Project "alpha": two worktrees (main + feature)
    const alphaMainWt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' }, web: { envVar: 'WEB_PORT' } },
    })
    const alphaFeatWt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' }, web: { envVar: 'WEB_PORT' } },
    })
    // Project "zeta": two worktrees
    const zetaMainWt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    const zetaFeatWt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })

    await seed(env, [
      // Intentionally seed out of sort order to prove the sort.
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/zeta/.git',
          namespace: 'feature-x',
          worktreeRoot: zetaFeatWt,
        }),
        { api: 4100 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/zeta/.git',
          namespace: 'main',
          worktreeRoot: zetaMainWt,
        }),
        { api: 4000 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/alpha/.git',
          namespace: 'feature-y',
          worktreeRoot: alphaFeatWt,
        }),
        { api: 3110, web: 3111 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/alpha/.git',
          namespace: 'main',
          worktreeRoot: alphaMainWt,
        }),
        { api: 3100, web: 3101 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)

    expect(snapshot.projects.map((p) => p.label)).toEqual(['alpha', 'zeta'])

    const alpha = snapshot.projects[0]
    expect(alpha.gitCommonDir).toBe('/repos/alpha/.git')
    expect(alpha.worktrees.map((w) => w.namespace)).toEqual([
      'feature-y',
      'main',
    ])
    // services in config order (api before web)
    expect(alpha.worktrees[1].services.map((s) => s.name)).toEqual([
      'api',
      'web',
    ])

    const zeta = snapshot.projects[1]
    expect(zeta.worktrees.map((w) => w.namespace)).toEqual([
      'feature-x',
      'main',
    ])
  })
})

// ---------------------------------------------------------------------------
// Test 4a: Label — explicit projectName
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — label: explicit projectName', () => {
  it('uses projectName when worktrees in the bucket set it', async () => {
    const wtMain = await trackedWorktree({
      projectName: 'My App',
      services: { api: { envVar: 'API_PORT' } },
    })
    const wtFeat = await trackedWorktree({
      projectName: 'My App',
      services: { api: { envVar: 'API_PORT' } },
    })

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/derived-name/.git',
          namespace: 'main',
          worktreeRoot: wtMain,
        }),
        { api: 3100 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/derived-name/.git',
          namespace: 'feature-z',
          worktreeRoot: wtFeat,
        }),
        { api: 3110 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0].label).toBe('My App')
  })
})

// ---------------------------------------------------------------------------
// Test 4b: Label — tiebreak
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — label: tiebreak', () => {
  it('prefers the main-namespace projectName over a feature worktree', async () => {
    const wtMain = await trackedWorktree({
      projectName: 'Main Name',
      services: { api: { envVar: 'API_PORT' } },
    })
    const wtFeat = await trackedWorktree({
      projectName: 'Feature Name',
      services: { api: { envVar: 'API_PORT' } },
    })

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/tb/.git',
          namespace: 'feature-a',
          worktreeRoot: wtFeat,
        }),
        { api: 3110 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/tb/.git',
          namespace: 'main',
          worktreeRoot: wtMain,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects[0].label).toBe('Main Name')
  })

  it('falls back to the first by namespace sort with a non-empty value when no main', async () => {
    // No 'main' namespace present. Namespace sort: 'feature-a' < 'feature-b'.
    const wtA = await trackedWorktree({
      projectName: 'A Name',
      services: { api: { envVar: 'API_PORT' } },
    })
    const wtB = await trackedWorktree({
      projectName: 'B Name',
      services: { api: { envVar: 'API_PORT' } },
    })

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/tb2/.git',
          namespace: 'feature-b',
          worktreeRoot: wtB,
        }),
        { api: 3110 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/tb2/.git',
          namespace: 'feature-a',
          worktreeRoot: wtA,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects[0].label).toBe('A Name')
  })
})

// ---------------------------------------------------------------------------
// Test 4c: Label — derived fallback
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — label: derived fallback', () => {
  it('derives the repo basename when no config sets projectName', async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/my-cool-repo/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects[0].label).toBe('my-cool-repo')
  })

  it("labels a null gitCommonDir bucket '(no repo)'", async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: null,
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects[0].gitCommonDir).toBeNull()
    expect(snapshot.projects[0].label).toBe('(no repo)')
  })

  it('falls back to the derived label when the only worktree is degraded', async () => {
    // A real dir with no config → degraded → contributes no projectName, so
    // the bucket label still derives from gitCommonDir.
    const wt = await mkdtemp(join(tmpdir(), 'pw-enrich-degraded-'))
    cleanupDirs.push(wt)
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/degraded-repo/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects[0].label).toBe('degraded-repo')
    expect(snapshot.projects[0].worktrees[0].degraded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 5: Healthy links
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — healthy links', () => {
  it('resolves discoveryEnv templates to URLs using the allocated port', async () => {
    const wt = await trackedWorktree({
      services: {
        api: {
          discoveryEnv: { VITE_API_URL: 'http://localhost:${api}' },
          envVar: 'API_PORT',
        },
      },
    })

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/links/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 31234 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    const service = snapshot.projects[0].worktrees[0].services[0]
    expect(service.name).toBe('api')
    expect(service.envVar).toBe('API_PORT')
    expect(service.port).toBe(31234)
    expect(service.links).toEqual([
      { envVar: 'VITE_API_URL', url: 'http://localhost:31234' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Test 6: No-template service → synthesized localhost link (A-1)
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — no-template service', () => {
  it('synthesizes a localhost link when a service declares no discoveryEnv', async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/nolinks/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects[0].worktrees[0].services[0].links).toEqual([
      { envVar: '', url: 'http://localhost:3100' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Test 7: Degraded — missing config
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — degraded: missing config', () => {
  it('marks degraded with raw ports and no throw when config is absent', async () => {
    // A real dir with NO portweave.config.json.
    const wt = await mkdtemp(join(tmpdir(), 'pw-enrich-nocfg-'))
    cleanupDirs.push(wt)

    await seedSingle('/repos/nocfg/.git', wt, { api: 3100, ws: 3101 })

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expectDegraded(snapshot, 'config missing', ['api', 'ws'])
    const worktree = snapshot.projects[0].worktrees[0]
    // Degraded services are now previewable: each raw port gets a synthesized
    // http://localhost:<port> link (A-1), but the service envVar stays unknown.
    const byName = new Map(worktree.services.map((s) => [s.name, s]))
    expect(byName.get('api')?.links).toEqual([
      { envVar: '', url: 'http://localhost:3100' },
    ])
    expect(byName.get('ws')?.links).toEqual([
      { envVar: '', url: 'http://localhost:3101' },
    ])
    expect(worktree.services.every((s) => s.envVar === '')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 8: Degraded — deleted directory
//
// The panel reads via the non-pruning readRegistryEntries (see
// registry/storage.ts), so an entry whose worktreeRoot is gone is NOT dropped:
// it surfaces as degraded with reason 'directory deleted'. This covers both the
// steady state (dir already gone at read time) and the race (dir vanishes
// between read and the per-entry stat) — the enrich existsSync check fires the
// same either way.
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — degraded: deleted directory', () => {
  it('marks a steady-state deleted-dir entry degraded with raw ports', async () => {
    // Seed while the dir exists (survives the seed's prune-on-write), then
    // delete it. The non-pruning panel read keeps it and degrades it.
    const wt = await mkdtemp(join(tmpdir(), 'pw-enrich-gone-'))
    await seedSingle('/repos/gone/.git', wt, { api: 3100 })
    await rm(wt, { force: true, recursive: true })

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expectDegraded(snapshot, 'directory deleted', ['api'])
  })

  it('marks degraded when the dir vanishes between read and enrich', async () => {
    // The TOCTOU race: dir exists at read time, deleted inside the probe before
    // the per-entry existsSync. probeAllPorts awaits every probe before any
    // enrichEntry runs, so the dir is gone at the existsSync call.
    const wt = await mkdtemp(join(tmpdir(), 'pw-enrich-race-'))
    cleanupDirs.push(wt)

    const deletingProbe: EnrichDeps = {
      probe: (): Promise<PanelLivenessStatus> => {
        rmSync(wt, { force: true, recursive: true })
        return Promise.resolve('not-running')
      },
    }

    await seedSingle('/repos/race/.git', wt, { api: 3100 })

    const snapshot = await buildPanelSnapshot(env, deletingProbe)
    expectDegraded(snapshot, 'directory deleted', ['api'])
  })
})

// ---------------------------------------------------------------------------
// Test 9: Degraded — invalid config
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — degraded: invalid config', () => {
  it('marks degraded with config invalid reason when JSON is malformed', async () => {
    const wt = await trackedWorktree('{ this is not valid json ')

    await seedSingle('/repos/bad/.git', wt, { api: 3100 })

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expectDegraded(snapshot, 'config invalid', ['api'])
  })
})

// ---------------------------------------------------------------------------
// Test 10: One broken among healthy
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — one broken among healthy', () => {
  it('enriches the healthy entry fully and degrades the broken one', async () => {
    const healthyWt = await trackedWorktree({
      services: {
        api: {
          discoveryEnv: { API_URL: 'http://localhost:${api}' },
          envVar: 'API_PORT',
        },
      },
    })
    // Broken = a deleted-dir entry: seed while it exists, then remove it. The
    // non-pruning panel read keeps it and degrades it 'directory deleted'.
    const brokenWt = await mkdtemp(join(tmpdir(), 'pw-enrich-broken-'))

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/healthy/.git',
          namespace: 'main',
          worktreeRoot: healthyWt,
        }),
        { api: 3100 },
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/broken/.git',
          namespace: 'main',
          worktreeRoot: brokenWt,
        }),
        { web: 3200 },
      ),
    ])
    await rm(brokenWt, { force: true, recursive: true })

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    expect(snapshot.projects).toHaveLength(2)

    const byLabel = new Map(snapshot.projects.map((p) => [p.label, p]))
    const healthy = byLabel.get('healthy')
    const broken = byLabel.get('broken')
    expect(healthy).toBeDefined()
    expect(broken).toBeDefined()
    if (healthy === undefined || broken === undefined) {
      return
    }

    expect(healthy.worktrees[0].degraded).toBe(false)
    expect(healthy.worktrees[0].services[0].links).toEqual([
      { envVar: 'API_URL', url: 'http://localhost:3100' },
    ])

    expect(broken.worktrees[0].degraded).toBe(true)
    expect(broken.worktrees[0].degradedReason).toBe('directory deleted')
    expect(broken.worktrees[0].services.map((s) => s.name)).toEqual(['web'])
  })
})

// ---------------------------------------------------------------------------
// Test 11: Read-only
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — read-only', () => {
  it('leaves the on-disk registry byte-identical, even with a stale entry', async () => {
    // The key regression guard: seed a healthy entry AND a deleted-dir entry,
    // then prove the panel read never rewrites the file. Under the old
    // prune-on-read path the stale entry would trigger a rewrite; the
    // non-pruning readRegistryEntries must leave the bytes untouched.
    const healthyWt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    const goneWt = await mkdtemp(join(tmpdir(), 'pw-enrich-ro-gone-'))

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/ro-a/.git',
          namespace: 'main',
          worktreeRoot: healthyWt,
        }),
        { api: 3100 },
        FIXED_TIME,
      ),
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/ro-b/.git',
          namespace: 'main',
          worktreeRoot: goneWt,
        }),
        { web: 3200 },
        FIXED_TIME,
      ),
    ])
    await rm(goneWt, { force: true, recursive: true })

    const registryFile = join(configDir, 'portweave', 'registry.json')
    const before = await readFile(registryFile, 'utf8')

    await buildPanelSnapshot(env, allNotRunning)
    await buildPanelSnapshot(env, allNotRunning)

    const after = await readFile(registryFile, 'utf8')
    expect(after).toBe(before)
    // The stale entry must still be present in the file (not pruned away).
    const entries = (JSON.parse(after) as { entries: RegistryEntry[] }).entries
    expect(entries.map((e) => e.key.worktreeRoot).sort()).toEqual(
      [healthyWt, goneWt].sort(),
    )
    expect(entries.every((e) => e.lastUsedAt === FIXED_TIME)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 12: Unsafe-scheme link filtering (DOM-XSS guard)
//
// discoveryEnv is validated only as z.string(), so a template can resolve to a
// `javascript:`/`data:` URL — a script-execution sink once rendered as an
// <a href>. The panel is machine-wide, so it may surface links from repos the
// viewer never authored. enrich must drop any resolved URL whose scheme is not
// in the http/https/ws/wss allowlist. A service left with only an unsafe URL
// keeps no explicit link, so resolveServiceLinks (A-1) then synthesizes a safe
// http://localhost:<port> in its place — the unsafe URL never survives.
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — unsafe-scheme link filtering', () => {
  it('keeps http/https links and drops javascript:/data: links', async () => {
    const wt = await trackedWorktree({
      services: {
        api: {
          discoveryEnv: {
            API_HTTP_URL: 'http://localhost:${api}',
            API_JS_URL: 'javascript:alert(1)',
          },
          envVar: 'API_PORT',
        },
        // A service whose ONLY discovery URL is unsafe → links must be empty.
        evil: {
          discoveryEnv: { EVIL_JS_URL: 'javascript:alert(document.cookie)' },
          envVar: 'EVIL_PORT',
        },
        web: {
          discoveryEnv: {
            WEB_DATA_URL: 'data:text/html,<script>alert(1)</script>',
            WEB_HTTPS_URL: 'https://web.local:${web}',
          },
          envVar: 'WEB_PORT',
        },
      },
    })

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/xss/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 31000, evil: 31002, web: 31001 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    const services = snapshot.projects[0].worktrees[0].services
    const byName = new Map(services.map((s) => [s.name, s]))

    // Safe links survive, mapped to their resolved URL.
    expect(byName.get('api')?.links).toEqual([
      { envVar: 'API_HTTP_URL', url: 'http://localhost:31000' },
    ])
    expect(byName.get('web')?.links).toEqual([
      { envVar: 'WEB_HTTPS_URL', url: 'https://web.local:31001' },
    ])

    // The unsafe URLs never appear in any service's links.
    const allUrls = services.flatMap((s) => s.links.map((l) => l.url))
    expect(allUrls).not.toContain('javascript:alert(1)')
    expect(allUrls).not.toContain('javascript:alert(document.cookie)')
    expect(allUrls).not.toContain('data:text/html,<script>alert(1)</script>')
    // Every surviving link still passes the scheme allowlist.
    expect(allUrls.every((url) => isSafeLinkUrl(url))).toBe(true)

    // A service whose only discovery URL is unsafe drops it, then gets a
    // synthesized safe http://localhost:<port> in its place (A-1).
    expect(byName.get('evil')?.links).toEqual([
      { envVar: '', url: 'http://localhost:31002' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Liveness wiring: injected probe statuses are stamped onto services
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — liveness stamping', () => {
  it('stamps each service with the injected probe status', async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' }, ws: { envVar: 'WS_PORT' } },
    })

    const statusByPort = new Map<number, PanelLivenessStatus>([
      [3100, 'live'],
      [3101, 'not-running'],
    ])
    const deps: EnrichDeps = {
      probe: (port) => Promise.resolve(statusByPort.get(port) ?? 'unknown'),
    }

    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/live/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100, ws: 3101 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, deps)
    const services = snapshot.projects[0].worktrees[0].services
    const api = services.find((s) => s.name === 'api')
    const ws = services.find((s) => s.name === 'ws')
    expect(api?.status).toBe('live')
    expect(ws?.status).toBe('not-running')
  })
})

// ---------------------------------------------------------------------------
// Service links (A-1): synthesis rules beyond the explicit-http case (Test 5)
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — service-link synthesis', () => {
  it('keeps a ws-only discovery URL AND appends a synthesized http link', async () => {
    const wt = await trackedWorktree({
      services: {
        rt: {
          discoveryEnv: { RT_WS_URL: 'ws://localhost:${rt}' },
          envVar: 'RT_PORT',
        },
      },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/ws/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { rt: 31234 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    // ws link preserved (not a browser preview) alongside the synthesized http.
    expect(snapshot.projects[0].worktrees[0].services[0].links).toEqual([
      { envVar: 'RT_WS_URL', url: 'ws://localhost:31234' },
      { envVar: '', url: 'http://localhost:31234' },
    ])
  })

  it('synthesizes an http link when the only discovery URL is a non-http scheme', async () => {
    const wt = await trackedWorktree({
      services: {
        db: {
          discoveryEnv: { DATABASE_URL: 'postgres://localhost:${db}/app' },
          envVar: 'DB_PORT',
        },
      },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/db/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { db: 35432 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    // postgres:// is dropped by isSafeLinkUrl, leaving only the synthesized one.
    expect(snapshot.projects[0].worktrees[0].services[0].links).toEqual([
      { envVar: '', url: 'http://localhost:35432' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Triage stamping (B-5): default fields with no provider, then injected stub
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — triage defaults (no provider)', () => {
  it('stamps safe defaults and capability flags when no triage provider is injected', async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/defaults/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const snapshot = await buildPanelSnapshot(env, allNotRunning)
    const worktree = snapshot.projects[0].worktrees[0]
    expect(worktree.kind).toBe('linked')
    expect(worktree.prStatus).toBeNull()
    expect(worktree.workingTreeClean).toBeNull()
    expect(worktree.diskSizeBytes).toBeNull()
    expect(worktree.safeToPrune).toBe(false)
    // removeCommand is always computed, even with no triage provider.
    expect(worktree.removeCommand).toContain('git worktree remove')
    expect(worktree.removeCommand).toContain(wt)
    // No provider → prStatus unavailable; launch follows the host platform.
    expect(snapshot.prStatusAvailable).toBe(false)
    expect(snapshot.launchSupported).toBe(process.platform === 'darwin')
  })
})

describe('buildPanelSnapshot — triage stamping (injected stub)', () => {
  const mergedPr: PanelPrStatus = {
    number: 1,
    state: 'merged',
    url: 'https://github.com/acme/app/pull/1',
  }

  it('stamps a linked+merged+clean worktree as safe to prune', async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/triage/.git',
          namespace: 'feature-x',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const triage: WorktreeTriage = {
      diskSizeBytes: 1024,
      kind: 'linked',
      prStatus: mergedPr,
      workingTreeClean: true,
    }
    const snapshot = await buildPanelSnapshot(env, {
      ...allNotRunning,
      triage: stubTriage(triage, true),
    })

    const worktree = snapshot.projects[0].worktrees[0]
    expect(worktree.kind).toBe('linked')
    expect(worktree.prStatus).toEqual(mergedPr)
    expect(worktree.workingTreeClean).toBe(true)
    expect(worktree.diskSizeBytes).toBe(1024)
    expect(worktree.safeToPrune).toBe(true)
    expect(worktree.removeCommand).toContain(wt)
    expect(snapshot.prStatusAvailable).toBe(true)
  })

  it('never marks the main checkout safe to prune, even when merged+clean', async () => {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(
        makeKey({
          gitCommonDir: '/repos/main-triage/.git',
          namespace: 'main',
          worktreeRoot: wt,
        }),
        { api: 3100 },
      ),
    ])

    const triage: WorktreeTriage = {
      diskSizeBytes: 2048,
      kind: 'main',
      prStatus: mergedPr,
      workingTreeClean: true,
    }
    const snapshot = await buildPanelSnapshot(env, {
      ...allNotRunning,
      triage: stubTriage(triage, false),
    })

    const worktree = snapshot.projects[0].worktrees[0]
    expect(worktree.kind).toBe('main')
    expect(worktree.safeToPrune).toBe(false)
    // The capability flag mirrors the stub's prStatusAvailable.
    expect(snapshot.prStatusAvailable).toBe(false)
  })

  it('still stamps triage fields (incl. removeCommand) on a degraded worktree', async () => {
    // Deleted-dir entry → degraded path, but triage is fetched up front and
    // stamped regardless: removeCommand is always present.
    const wt = await mkdtemp(join(tmpdir(), 'pw-enrich-triage-degraded-'))
    await seedSingle('/repos/degraded-triage/.git', wt, { api: 3100 })
    await rm(wt, { force: true, recursive: true })

    const triage: WorktreeTriage = {
      diskSizeBytes: 512,
      kind: 'linked',
      prStatus: null,
      workingTreeClean: false,
    }
    const snapshot = await buildPanelSnapshot(env, {
      ...allNotRunning,
      triage: stubTriage(triage, true),
    })

    const worktree = snapshot.projects[0].worktrees[0]
    expect(worktree.degraded).toBe(true)
    expect(worktree.degradedReason).toBe('directory deleted')
    expect(worktree.kind).toBe('linked')
    expect(worktree.diskSizeBytes).toBe(512)
    // PR-unknown (null) → never safe, even though the dir is degraded.
    expect(worktree.safeToPrune).toBe(false)
    expect(worktree.removeCommand).toContain('git worktree remove')
    expect(worktree.removeCommand).toContain(wt)
  })
})

// ---------------------------------------------------------------------------
// forceTriage passthrough: deps.forceTriage reaches the provider's triageFor
// (additive to the frozen positional buildPanelSnapshot(env, deps?) contract).
// ---------------------------------------------------------------------------
describe('buildPanelSnapshot — forceTriage passthrough', () => {
  const triage: WorktreeTriage = {
    diskSizeBytes: 1024,
    kind: 'linked',
    prStatus: null,
    workingTreeClean: true,
  }

  async function seedOne(gitCommonDir: string): Promise<string> {
    const wt = await trackedWorktree({
      services: { api: { envVar: 'API_PORT' } },
    })
    await seed(env, [
      makeEntry(makeKey({ gitCommonDir, namespace: 'main', worktreeRoot: wt }), {
        api: 3100,
      }),
    ])
    return wt
  }

  it('passes deps.forceTriage through to the provider per worktree', async () => {
    await seedOne('/repos/force/.git')
    const provider = stubTriage(triage, true)

    await buildPanelSnapshot(env, {
      ...allNotRunning,
      forceTriage: true,
      triage: provider,
    })

    expect(provider.forceCalls).toEqual([true])
  })

  it('defaults the provider force flag to false when forceTriage is unset', async () => {
    await seedOne('/repos/noforce/.git')
    const provider = stubTriage(triage, true)

    await buildPanelSnapshot(env, { ...allNotRunning, triage: provider })

    expect(provider.forceCalls).toEqual([false])
  })
})
