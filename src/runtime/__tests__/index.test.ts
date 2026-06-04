import { execFileSync } from 'node:child_process'
import { realpathSync, rmSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindServerOnPort } from '../../allocator/__tests__/_helpers.ts'
import { PW_ERROR_CODES } from '../../errors.ts'
import {
  addGitWorktree,
  createTempGitRepo,
} from '../../worktree/__tests__/_helpers.ts'
import { allocation, env, namespace, ports } from '../index.ts'
import { setupScopedXdg } from './_helpers.ts'

setupScopedXdg()

const VALID_CONFIG = JSON.stringify({
  services: {
    api: { envVar: 'API_PORT' },
    web: { envVar: 'WEB_PORT' },
  },
})

async function makeTmpDir(label: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `portweave-runtime-test-${label}-${process.pid.toString()}-${Date.now().toString()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}

async function makeFixtureProject(label: string): Promise<string> {
  const dir = await makeTmpDir(label)
  await writeFile(join(dir, 'portweave.config.json'), VALID_CONFIG)
  return dir
}

// A real git repo (vs makeFixtureProject's plain dir) so the worktree key is
// derived from git context — the only setup in which the cwd-stability bug
// (gitCommonDir resolved against the wrong base) can surface. realpathSync
// matches git's canonical --show-toplevel output on macOS (/var → /private/var).
async function makeGitFixtureProject(label: string): Promise<string> {
  const dir = realpathSync(await makeTmpDir(label))
  const runGit = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  runGit(['init', '--initial-branch=main'])
  runGit(['config', 'user.email', 'test@portweave.local'])
  runGit(['config', 'user.name', 'Portweave Test'])
  runGit(['commit', '--allow-empty', '-m', 'init'])
  await writeFile(join(dir, 'portweave.config.json'), VALID_CONFIG)
  return dir
}

describe('ports()', () => {
  it('returns ok with Record<string, number> for a valid project', async () => {
    const projectRoot = await makeFixtureProject('ports-basic')
    const result = await ports({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(typeof result.value.api).toBe('number')
    expect(typeof result.value.web).toBe('number')
    expect(result.value.api).toBeGreaterThan(0)
    expect(result.value.web).toBeGreaterThan(0)
  })

  it('returns keys matching exactly the service names in the config', async () => {
    const projectRoot = await makeFixtureProject('ports-keys')
    const result = await ports({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(Object.keys(result.value).sort()).toStrictEqual(['api', 'web'])
  })

  it('writes .portweave/current.env on success', async () => {
    const projectRoot = await makeFixtureProject('ports-env-write')
    const result = await ports({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    const currentEnvPath = join(projectRoot, '.portweave', 'current.env')
    const contents = await readFile(currentEnvPath, 'utf-8')
    expect(contents).toContain('API_PORT=')
    expect(contents).toContain('WEB_PORT=')
  })
})

describe('env()', () => {
  it('returns ok with Record<string, string> including all service envVar keys', async () => {
    const projectRoot = await makeFixtureProject('env-basic')
    const result = await env({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(typeof result.value.API_PORT).toBe('string')
    expect(typeof result.value.WEB_PORT).toBe('string')
  })

  it('returns string values that parse as port numbers', async () => {
    const projectRoot = await makeFixtureProject('env-values')
    const result = await env({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(Number(result.value.API_PORT)).toBeGreaterThan(0)
    expect(Number(result.value.WEB_PORT)).toBeGreaterThan(0)
  })

  it('includes discoveryEnv keys when the config specifies them', async () => {
    const configWithDiscovery = JSON.stringify({
      services: {
        api: {
          discoveryEnv: { VITE_API_URL: 'http://localhost:${api}' },
          envVar: 'API_PORT',
        },
      },
    })
    const dir = await makeTmpDir('env-discovery')
    await writeFile(join(dir, 'portweave.config.json'), configWithDiscovery)
    const result = await env({ cwd: dir })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.VITE_API_URL).toMatch(/^http:\/\/localhost:\d+$/)
  })

  it('resolves a ${namespace}-templated discoveryEnv value (integration)', async () => {
    const configWithNamespace = JSON.stringify({
      services: {
        api: {
          discoveryEnv: {
            API_URL: 'http://localhost:${api}/${namespace}',
            DDB_TABLE_PREFIX: 'local-${namespace}',
          },
          envVar: 'API_PORT',
        },
      },
    })
    const dir = await makeTmpDir('env-namespace-template')
    await writeFile(join(dir, 'portweave.config.json'), configWithNamespace)
    const [result, ns] = await Promise.all([
      env({ cwd: dir }),
      namespace({ cwd: dir }),
    ])
    expect(result.ok).toBe(true)
    expect(ns.ok).toBe(true)
    if (!result.ok || !ns.ok) {
      return
    }
    // Non-git tmp dir → namespace is "main".
    expect(result.value.DDB_TABLE_PREFIX).toBe('local-main')
    expect(result.value.API_URL).toMatch(/^http:\/\/localhost:\d+\/main$/)
    // The substituted namespace equals namespace() for the same cwd.
    expect(result.value.DDB_TABLE_PREFIX).toBe(`local-${ns.value}`)
  })
})

describe('allocation()', () => {
  it('returns ok with a full Allocation object', async () => {
    const projectRoot = await makeFixtureProject('alloc-basic')
    const result = await allocation({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.key).toBeDefined()
    expect(result.value.ports).toBeDefined()
    expect(result.value.lastUsedAt).toBeDefined()
    expect(result.value.namespace).toBeDefined()
  })

  it('ports in Allocation match the ports() result', async () => {
    const projectRoot = await makeFixtureProject('alloc-ports-match')
    const [allocResult, portsResult] = await Promise.all([
      allocation({ cwd: projectRoot }),
      ports({ cwd: projectRoot }),
    ])
    expect(allocResult.ok).toBe(true)
    expect(portsResult.ok).toBe(true)
    if (!allocResult.ok || !portsResult.ok) {
      return
    }
    expect(allocResult.value.ports).toStrictEqual(portsResult.value)
  })

  it('key.worktreeRoot is set to a non-empty string', async () => {
    const projectRoot = await makeFixtureProject('alloc-key')
    const result = await allocation({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(typeof result.value.key.worktreeRoot).toBe('string')
    expect(result.value.key.worktreeRoot.length).toBeGreaterThan(0)
  })
})

describe('upward-walk config discovery', () => {
  it('finds portweave.config.json from a subdirectory', async () => {
    const projectRoot = await makeFixtureProject('upwalk-sub')
    const subdir = join(projectRoot, 'packages', 'web', 'src')
    await mkdir(subdir, { recursive: true })
    const result = await ports({ cwd: subdir })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(Object.keys(result.value).sort()).toStrictEqual(['api', 'web'])
  })

  it('succeeds from both project root and 3 levels deep (finds same config)', async () => {
    // In a non-git directory each unique cwd becomes its own worktree root,
    // so the two calls will NOT share a registry entry — but both should succeed
    // and return valid allocations for the same set of services.
    const projectRoot = await makeFixtureProject('upwalk-same')
    const subdir = join(projectRoot, 'a', 'b', 'c')
    await mkdir(subdir, { recursive: true })
    const [rootResult, subResult] = await Promise.all([
      ports({ cwd: projectRoot }),
      ports({ cwd: subdir }),
    ])
    expect(rootResult.ok).toBe(true)
    expect(subResult.ok).toBe(true)
    if (!rootResult.ok || !subResult.ok) {
      return
    }
    // Both calls discovered the same config (2 services), so same key set
    expect(Object.keys(subResult.value).sort()).toStrictEqual(
      Object.keys(rootResult.value).sort(),
    )
  })
})

describe('explicit opts.configPath', () => {
  it('resolves a relative configPath against opts.cwd', async () => {
    const dir = await makeTmpDir('explicit-config')
    const altConfigPath = join(dir, 'custom.portweave.json')
    await writeFile(
      altConfigPath,
      JSON.stringify({ services: { db: { envVar: 'DB_PORT' } } }),
    )
    const result = await ports({
      configPath: 'custom.portweave.json',
      cwd: dir,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(typeof result.value.db).toBe('number')
  })

  it('bypasses the upward walk when configPath is set', async () => {
    // Parent has no config; child provides explicit configPath
    const parent = await makeTmpDir('bypass-walk-parent')
    const child = join(parent, 'child')
    await mkdir(child, { recursive: true })
    const configInChild = join(child, 'portweave.config.json')
    await writeFile(
      configInChild,
      JSON.stringify({ services: { svc: { envVar: 'SVC_PORT' } } }),
    )
    // cwd=parent, configPath relative to parent → points into child
    const result = await ports({
      configPath: 'child/portweave.config.json',
      cwd: parent,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(typeof result.value.svc).toBe('number')
  })

  it('returns PW0101 when explicit configPath does not exist', async () => {
    const dir = await makeTmpDir('explicit-missing')
    const result = await ports({ configPath: 'does-not-exist.json', cwd: dir })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_MISSING)
  })
})

describe('anonymous fallback (count option)', () => {
  it('returns 3 ports under port-1, port-2, port-3 keys', async () => {
    const dir = await makeTmpDir('anon-fallback')
    const result = await ports({ count: 3, cwd: dir })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(Object.keys(result.value).sort()).toStrictEqual([
      'port-1',
      'port-2',
      'port-3',
    ])
  })

  it('writes .portweave/current.env with PORT_1, PORT_2, PORT_3', async () => {
    const dir = await makeTmpDir('anon-env-write')
    await ports({ count: 3, cwd: dir })
    const contents = await readFile(
      join(dir, '.portweave', 'current.env'),
      'utf-8',
    )
    expect(contents).toContain('PORT_1=')
    expect(contents).toContain('PORT_2=')
    expect(contents).toContain('PORT_3=')
  })
})

describe('no-config-no-count error', () => {
  it('returns err with RUNTIME_CONFIG_NOT_FOUND when neither config nor count is provided', async () => {
    const dir = await makeTmpDir('no-config-no-count')
    const result = await ports({ cwd: dir })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.RUNTIME_CONFIG_NOT_FOUND)
    expect(result.error.message).toContain(dir)
  })
})

describe('concurrent callers', () => {
  it('two parallel ports() calls produce a single coherent allocation', async () => {
    const projectRoot = await makeFixtureProject('concurrent')
    const [r1, r2] = await Promise.all([
      ports({ cwd: projectRoot }),
      ports({ cwd: projectRoot }),
    ])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) {
      return
    }
    // Same project → both calls must observe identical ports
    expect(r1.value).toStrictEqual(r2.value)
  })
})

describe('current.env side-effect matches env() result', () => {
  it('.portweave/current.env contains the same key=value pairs env() returns', async () => {
    const projectRoot = await makeFixtureProject('env-side-effect')
    const envResult = await env({ cwd: projectRoot })
    expect(envResult.ok).toBe(true)
    if (!envResult.ok) {
      return
    }
    const currentEnvPath = join(projectRoot, '.portweave', 'current.env')
    const contents = await readFile(currentEnvPath, 'utf-8')
    for (const [key, val] of Object.entries(envResult.value)) {
      expect(contents).toContain(`${key}=${val}`)
    }
  })
})

describe('.env override semantics', () => {
  it('ports() applies .env overrides for service envVars', async () => {
    const projectRoot = await makeFixtureProject('ports-override')
    await writeFile(join(projectRoot, '.env'), 'WEB_PORT=6766\nAPI_PORT=6767\n')
    const result = await ports({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.web).toBe(6766)
    expect(result.value.api).toBe(6767)
  })

  it('env() applies .env overrides for service envVars', async () => {
    const projectRoot = await makeFixtureProject('env-override')
    await writeFile(join(projectRoot, '.env'), 'WEB_PORT=6766\n')
    const result = await env({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.WEB_PORT).toBe('6766')
  })

  it('allocation() returns raw allocation, ignoring .env overrides', async () => {
    const projectRoot = await makeFixtureProject('alloc-ignores-override')
    await writeFile(join(projectRoot, '.env'), 'WEB_PORT=6766\n')
    const result = await allocation({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    // Raw allocator output lives in the configured pool range (default 30000–60000),
    // not the override value.
    expect(result.value.ports.web).not.toBe(6766)
    expect(result.value.ports.web).toBeGreaterThanOrEqual(30000)
  })

  it('ports() returns PW0503 when a .env override is not a valid port integer', async () => {
    const projectRoot = await makeFixtureProject('ports-bad-override')
    await writeFile(join(projectRoot, '.env'), 'WEB_PORT=not-a-number\n')
    const result = await ports({ cwd: projectRoot })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(
      PW_ERROR_CODES.ENV_DOTENV_PORT_OVERRIDE_INVALID,
    )
    expect(result.error.message).toContain('WEB_PORT')
    expect(result.error.message).toContain('not-a-number')
  })

  it('ports() returns PW0503 when a .env override is out of port range', async () => {
    const projectRoot = await makeFixtureProject('ports-oor-override')
    await writeFile(join(projectRoot, '.env'), 'WEB_PORT=70000\n')
    const result = await ports({ cwd: projectRoot })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(
      PW_ERROR_CODES.ENV_DOTENV_PORT_OVERRIDE_INVALID,
    )
  })

  it('ports() and env() agree on the overridden numeric port', async () => {
    const projectRoot = await makeFixtureProject('ports-env-agree')
    await writeFile(join(projectRoot, '.env'), 'WEB_PORT=6766\n')
    const [portsResult, envResult] = await Promise.all([
      ports({ cwd: projectRoot }),
      env({ cwd: projectRoot }),
    ])
    expect(portsResult.ok).toBe(true)
    expect(envResult.ok).toBe(true)
    if (!portsResult.ok || !envResult.ok) {
      return
    }
    expect(String(portsResult.value.web)).toBe(envResult.value.WEB_PORT)
  })
})

describe('idempotent runtime reads while allocated ports are bound (regression)', () => {
  // Regression for the downstream "config consumer resolves a different block"
  // bug: a config file calls ports()/env()/allocation() to discover its own
  // port AFTER sibling services from the same allocation are already up and
  // bound. Repeated reads for the same worktree must return the SAME block —
  // a bound port owned by this allocation is the normal runtime state, not a
  // conflict that should trigger reallocation. See decision-log #37.
  it('allocation() is stable across calls while one of its ports is bound', async () => {
    const projectRoot = await makeFixtureProject('idem-allocation')
    const first = await allocation({ cwd: projectRoot })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    const server = await bindServerOnPort(first.value.ports.api)
    try {
      const second = await allocation({ cwd: projectRoot })
      expect(second.ok).toBe(true)
      if (!second.ok) {
        return
      }
      expect(second.value.ports).toStrictEqual(first.value.ports)
    } finally {
      await server.close()
    }
  })

  it('ports() and env() are stable across repeated calls while a port is bound', async () => {
    const projectRoot = await makeFixtureProject('idem-ports-env')
    const firstPorts = await ports({ cwd: projectRoot })
    expect(firstPorts.ok).toBe(true)
    if (!firstPorts.ok) {
      return
    }

    const server = await bindServerOnPort(firstPorts.value.api)
    try {
      const [secondPorts, secondEnv] = await Promise.all([
        ports({ cwd: projectRoot }),
        env({ cwd: projectRoot }),
      ])
      expect(secondPorts.ok).toBe(true)
      expect(secondEnv.ok).toBe(true)
      if (!secondPorts.ok || !secondEnv.ok) {
        return
      }
      expect(secondPorts.value).toStrictEqual(firstPorts.value)
      expect(Number(secondEnv.value.API_PORT)).toBe(firstPorts.value.api)
      expect(Number(secondEnv.value.WEB_PORT)).toBe(firstPorts.value.web)
    } finally {
      await server.close()
    }
  })

  it('mirrors the failing scenario: siblings bound, ports() still resolves the original block', async () => {
    // app/api/web mirror the orchestrator case: api + web (the "siblings")
    // bind their injected ports first, then the app's own config file resolves
    // its port via ports() — which must still see the originally allocated app
    // port, not a freshly reallocated block.
    const dir = await makeTmpDir('e2e-sibling-listeners')
    await writeFile(
      join(dir, 'portweave.config.json'),
      JSON.stringify({
        services: {
          api: { envVar: 'API_PORT' },
          app: { envVar: 'APP_PORT' },
          web: { envVar: 'WEB_PORT' },
        },
      }),
    )

    // The block the orchestrator would inject into the child process.
    const injected = await ports({ cwd: dir })
    expect(injected.ok).toBe(true)
    if (!injected.ok) {
      return
    }

    // Sibling services come up and bind their raw ports.
    const siblings = await Promise.all([
      bindServerOnPort(injected.value.api),
      bindServerOnPort(injected.value.web),
    ])
    try {
      // The app's config file now resolves its own port at runtime.
      const resolved = await ports({ cwd: dir })
      expect(resolved.ok).toBe(true)
      if (!resolved.ok) {
        return
      }
      expect(resolved.value.app).toBe(injected.value.app)
      expect(resolved.value).toStrictEqual(injected.value)
    } finally {
      await Promise.all(siblings.map((server) => server.close()))
    }
  })
})

describe('cwd-stability within one git project (monorepo subdir)', () => {
  const createdDirs: string[] = []

  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()
      if (dir !== undefined) {
        await rm(dir, { force: true, recursive: true })
      }
    }
  })

  async function gitProjectWithSubdir(
    label: string,
  ): Promise<{ root: string; subdir: string }> {
    const root = await makeGitFixtureProject(label)
    createdDirs.push(root)
    const subdir = join(root, 'packages', 'app', 'deep')
    await mkdir(subdir, { recursive: true })
    return { root, subdir }
  }

  it('ports(): allocate from the repo root, then resolve from a subdir → identical ports', async () => {
    const { root, subdir } = await gitProjectWithSubdir('cwd-ports')
    // Sequential: the root call allocates the block; the subdir call must reuse
    // it. Before the fix the subdir produced a divergent key and a fresh block.
    const rootResult = await ports({ cwd: root })
    const subResult = await ports({ cwd: subdir })
    expect(rootResult.ok && subResult.ok).toBe(true)
    if (!rootResult.ok || !subResult.ok) {
      return
    }
    expect(subResult.value).toStrictEqual(rootResult.value)
  })

  it('env(): identical env map from the repo root and a subdir', async () => {
    const { root, subdir } = await gitProjectWithSubdir('cwd-env')
    const rootResult = await env({ cwd: root })
    const subResult = await env({ cwd: subdir })
    expect(rootResult.ok && subResult.ok).toBe(true)
    if (!rootResult.ok || !subResult.ok) {
      return
    }
    expect(subResult.value).toStrictEqual(rootResult.value)
  })

  it('allocation(): identical ports and key from the repo root and a subdir', async () => {
    const { root, subdir } = await gitProjectWithSubdir('cwd-alloc')
    const rootResult = await allocation({ cwd: root })
    const subResult = await allocation({ cwd: subdir })
    expect(rootResult.ok && subResult.ok).toBe(true)
    if (!rootResult.ok || !subResult.ok) {
      return
    }
    expect(subResult.value.ports).toStrictEqual(rootResult.value.ports)
    expect(subResult.value.key).toStrictEqual(rootResult.value.key)
  })
})

describe('namespace()', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('equals allocation().namespace and the PORTWEAVE_NAMESPACE env for the same cwd', async () => {
    const projectRoot = await makeFixtureProject('ns-agree')
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    const [nsResult, allocResult, envResult] = await Promise.all([
      namespace({ cwd: projectRoot }),
      allocation({ cwd: projectRoot }),
      env({ cwd: projectRoot }),
    ])
    expect(nsResult.ok).toBe(true)
    expect(allocResult.ok).toBe(true)
    expect(envResult.ok).toBe(true)
    if (!nsResult.ok || !allocResult.ok || !envResult.ok) {
      return
    }
    expect(nsResult.value).toBe(allocResult.value.namespace)
    expect(nsResult.value).toBe(envResult.value.PORTWEAVE_NAMESPACE)
  })

  it('returns "main" for a non-git fixture (primary-worktree equivalent)', async () => {
    const projectRoot = await makeFixtureProject('ns-main')
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    const result = await namespace({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toBe('main')
  })

  it('honors a PORTWEAVE_NAMESPACE override (slugified)', async () => {
    const projectRoot = await makeFixtureProject('ns-override')
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'My Override!')
    const result = await namespace({ cwd: projectRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toBe('my-override')
  })

  it('resolves with no config file and writes no .portweave/current.env (no port side effects)', async () => {
    // Unlike ports()/env()/allocation(), namespace() needs no config: it resolves
    // via resolveAllocationKey alone, with no registry lock or port probing.
    const dir = await makeTmpDir('ns-no-side-effects')
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    const result = await namespace({ cwd: dir })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toBe('main')
    await expect(
      readFile(join(dir, '.portweave', 'current.env'), 'utf-8'),
    ).rejects.toThrow()
  })

  it('passes through resolveAllocationKey errors (bad PORTWEAVE_OFFSET)', async () => {
    const projectRoot = await makeFixtureProject('ns-bad-offset')
    vi.stubEnv('PORTWEAVE_OFFSET', 'not-a-number')
    const result = await namespace({ cwd: projectRoot })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.WORKTREE_OFFSET_INVALID)
  })
})

describe('namespace() — git worktree resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns "main" for the primary worktree and a slug-hash for a linked worktree', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')
    const repo = createTempGitRepo()
    const featureSuffix = `feat-${Date.now().toString(36)}`
    const featurePath = join(repo.root, '..', featureSuffix)
    try {
      addGitWorktree(repo.root, `feature/${featureSuffix}`, featurePath)
      const [mainNs, featureNs] = await Promise.all([
        namespace({ cwd: repo.root }),
        namespace({ cwd: featurePath }),
      ])
      expect(mainNs.ok).toBe(true)
      expect(featureNs.ok).toBe(true)
      if (!mainNs.ok || !featureNs.ok) {
        return
      }
      expect(mainNs.value).toBe('main')
      expect(featureNs.value).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/)
      expect(featureNs.value).not.toBe('main')
    } finally {
      rmSync(featurePath, { force: true, recursive: true })
      repo.cleanup()
    }
  })

  it('is cwd-stable: identical from the worktree root and a nested subdirectory', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    vi.stubEnv('PORTWEAVE_OFFSET', '')
    const repo = createTempGitRepo()
    const featureSuffix = `feat-${Date.now().toString(36)}-sub`
    const featurePath = join(repo.root, '..', featureSuffix)
    try {
      addGitWorktree(repo.root, `feature/${featureSuffix}`, featurePath)
      const deepSubdir = join(featurePath, 'packages', 'web', 'src')
      await mkdir(deepSubdir, { recursive: true })
      const [rootNs, subNs] = await Promise.all([
        namespace({ cwd: featurePath }),
        namespace({ cwd: deepSubdir }),
      ])
      expect(rootNs.ok).toBe(true)
      expect(subNs.ok).toBe(true)
      if (!rootNs.ok || !subNs.ok) {
        return
      }
      // cwd-stability regression guard (rides on the git-common-dir fix): the
      // namespace must not change with the directory you call it from.
      expect(subNs.value).toBe(rootNs.value)
      expect(rootNs.value).not.toBe('main')
    } finally {
      rmSync(featurePath, { force: true, recursive: true })
      repo.cleanup()
    }
  })
})
