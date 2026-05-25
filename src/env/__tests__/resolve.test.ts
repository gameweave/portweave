import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Allocation } from '../../allocator/allocate.ts'
import type { Config } from '../../config/index.ts'
import { resolveEnv } from '../resolve.ts'

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
})
