import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { allocation, env, ports } from '../index.ts'

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
