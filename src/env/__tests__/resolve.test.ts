import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Allocation } from '../../allocator/allocate.ts'
import type { Config } from '../../config/index.ts'
import { computeEnvMap, resolveEnv } from '../resolve.ts'

async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `portweave-resolve-test-${process.pid.toString()}-${Date.now().toString()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}

// Minimal config: api service with envVar=API_PORT and a discovery URL
const testConfig: Config = {
  envAuthority: 'dotenv',
  groups: {},
  services: [
    {
      discoveryEnv: {
        VITE_API_URL: 'http://localhost:${api}',
      },
      envVar: 'API_PORT',
      name: 'api',
    },
  ],
  source: 'file',
}

const testAllocation: Allocation = {
  key: {
    gitCommonDir: '/fake/.git',
    namespace: 'main',
    offsetOverride: null,
    worktreeRoot: '/fake/project',
  },
  lastUsedAt: '2026-05-26T00:00:00.000Z',
  namespace: 'main',
  ports: { api: 30100 },
}

describe('resolveEnv', () => {
  it('returns the computed env and writes .portweave/current.env', async () => {
    const projectRoot = await makeTmpDir()
    const result = await resolveEnv(testAllocation, testConfig, projectRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.env.API_PORT).toBe('30100')
    expect(result.value.env.VITE_API_URL).toBe('http://localhost:30100')
    expect(result.value.createdPortweaveDir).toBe(true)

    const written = await readFile(result.value.currentEnvPath, 'utf-8')
    expect(written).toContain('API_PORT=30100')
    expect(written).toContain('VITE_API_URL=http://localhost:30100')
  })

  it('applies .env override: API_PORT=4000 wins over computed 30100', async () => {
    const projectRoot = await makeTmpDir()
    // Write a .env file with API_PORT=4000 and an unrelated key
    await writeFile(
      join(projectRoot, '.env'),
      'API_PORT=4000\nOTHER_THING=foo\n',
      'utf-8',
    )

    const result = await resolveEnv(testAllocation, testConfig, projectRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    // API_PORT overridden by .env
    expect(result.value.env.API_PORT).toBe('4000')
    // Discovery URL still uses ALLOCATED port (30100), not overridden value
    expect(result.value.env.VITE_API_URL).toBe('http://localhost:30100')
    // Unrelated key is NOT forwarded
    expect(result.value.env.OTHER_THING).toBeUndefined()
  })

  it('writes the same values to .portweave/current.env as are in env', async () => {
    const projectRoot = await makeTmpDir()
    await writeFile(join(projectRoot, '.env'), 'API_PORT=4000\n', 'utf-8')

    const result = await resolveEnv(testAllocation, testConfig, projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const written = await readFile(result.value.currentEnvPath, 'utf-8')
    // Both the override value and the discovery URL are in the file
    expect(written).toContain('API_PORT=4000')
    expect(written).toContain('VITE_API_URL=http://localhost:30100')
  })

  it('creates .portweave/.gitignore on first run', async () => {
    const projectRoot = await makeTmpDir()
    const result = await resolveEnv(testAllocation, testConfig, projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const gitignore = await readFile(
      join(projectRoot, '.portweave', '.gitignore'),
      'utf-8',
    )
    expect(gitignore).toBe('*\n')
  })

  it('returns ok on a second call, createdPortweaveDir is false', async () => {
    const projectRoot = await makeTmpDir()
    await resolveEnv(testAllocation, testConfig, projectRoot)
    const result = await resolveEnv(testAllocation, testConfig, projectRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.createdPortweaveDir).toBe(false)
  })

  it('returns ok({}) env and writes file even when no .env present', async () => {
    const projectRoot = await makeTmpDir()
    const result = await resolveEnv(testAllocation, testConfig, projectRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    // Computed values used when no .env
    expect(result.value.env.API_PORT).toBe('30100')
  })

  it('writes PORTWEAVE_NAMESPACE to env and current.env', async () => {
    const projectRoot = await makeTmpDir()
    const result = await resolveEnv(testAllocation, testConfig, projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.env.PORTWEAVE_NAMESPACE).toBe('main')
    const written = await readFile(result.value.currentEnvPath, 'utf-8')
    expect(written).toContain('PORTWEAVE_NAMESPACE=main')
  })

  it('PORTWEAVE_NAMESPACE is authoritative: a .env hijack does not change it', async () => {
    const projectRoot = await makeTmpDir()
    await writeFile(
      join(projectRoot, '.env'),
      'PORTWEAVE_NAMESPACE=hijack\n',
      'utf-8',
    )

    const result = await resolveEnv(testAllocation, testConfig, projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    // .env value is ignored — the reported namespace is the one allocated
    expect(result.value.env.PORTWEAVE_NAMESPACE).toBe('main')
    const written = await readFile(result.value.currentEnvPath, 'utf-8')
    expect(written).toContain('PORTWEAVE_NAMESPACE=main')
    expect(written).not.toContain('PORTWEAVE_NAMESPACE=hijack')
  })
})

const portweaveAuthorityConfig: Config = {
  ...testConfig,
  envAuthority: 'portweave',
}

async function envFor(
  config: Config,
  projectRoot: string,
): Promise<Record<string, string>> {
  const result = await resolveEnv(testAllocation, config, projectRoot)
  if (!result.ok) {
    throw new Error(`expected resolveEnv to succeed: ${result.error.message}`)
  }
  return result.value.env
}

async function dirWithDotenv(contents: string): Promise<string> {
  const projectRoot = await makeTmpDir()
  await writeFile(join(projectRoot, '.env'), contents, 'utf-8')
  return projectRoot
}

describe('resolveEnv — envAuthority: portweave', () => {
  it('keeps the computed port when .env pins the same key', async () => {
    const root = await dirWithDotenv(
      'API_PORT=4000\nVITE_API_URL=http://localhost:4000\n',
    )
    const env = await envFor(portweaveAuthorityConfig, root)
    expect(env.API_PORT).toBe('30100')
    expect(env.VITE_API_URL).toBe('http://localhost:30100')
  })

  it('writes the computed values to .portweave/current.env too', async () => {
    const root = await dirWithDotenv('API_PORT=4000\n')
    await envFor(portweaveAuthorityConfig, root)
    const written = await readFile(
      join(root, '.portweave', 'current.env'),
      'utf-8',
    )
    expect(written).toContain('API_PORT=30100')
    expect(written).not.toContain('API_PORT=4000')
  })

  it('does not read .env at all, so a line this parser cannot handle is harmless', async () => {
    // A multi-line PEM is the realistic version of this: the minimal dotenv
    // parser rejects the continuation lines with PW0502, which under dotenv
    // authority takes the whole run down.
    const root = await dirWithDotenv(
      '-----BEGIN PRIVATE KEY-----\nnot a key=value line\n',
    )
    const underDotenv = await resolveEnv(testAllocation, testConfig, root)
    expect(underDotenv.ok).toBe(false)

    const env = await envFor(portweaveAuthorityConfig, root)
    expect(env.API_PORT).toBe('30100')
  })
})

describe('computeEnvMap', () => {
  async function computeFor(
    config: Config,
    projectRoot: string,
  ): Promise<Record<string, string>> {
    const result = await computeEnvMap(testAllocation, config, projectRoot)
    if (!result.ok) {
      throw new Error(
        `expected computeEnvMap to succeed: ${result.error.message}`,
      )
    }
    return result.value
  }

  it('returns what resolveEnv would inject without writing .portweave', async () => {
    const root = await dirWithDotenv('API_PORT=4000\n')
    // Same override the child process would see...
    expect((await computeFor(testConfig, root)).API_PORT).toBe('4000')
    // ...and no side effect on disk.
    await expect(
      readFile(join(root, '.portweave', 'current.env'), 'utf-8'),
    ).rejects.toThrow()
  })

  it('honours envAuthority the same way resolveEnv does', async () => {
    const root = await dirWithDotenv('API_PORT=4000\n')
    expect((await computeFor(portweaveAuthorityConfig, root)).API_PORT).toBe(
      '30100',
    )
  })
})
