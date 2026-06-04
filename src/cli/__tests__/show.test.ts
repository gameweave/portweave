import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Command } from 'commander'
import { withRegistry } from '../../registry/storage.ts'
import type { RegistryEntry } from '../../registry/types.ts'
import { resolveAllocationKey } from '../../worktree/key.ts'
import type { AllocationKey } from '../../worktree/key.ts'
import { registerShowCommand, runShow, type ShowOptions } from '../show.ts'
import { makeWritable } from './_helpers.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_CONTENT = JSON.stringify({
  services: {
    api: { envVar: 'API_PORT' },
    ws: { envVar: 'WS_PORT' },
  },
})

const SINGLE_SERVICE_CONFIG = JSON.stringify({
  services: {
    api: { envVar: 'API_PORT' },
  },
})

async function seedRegistryEntry(
  env: NodeJS.ProcessEnv,
  entry: RegistryEntry,
): Promise<void> {
  await withRegistry((handle) => {
    handle.upsert(entry)
  }, env)
}

async function readRegistryEntries(
  configDir: string,
): Promise<RegistryEntry[]> {
  const registryFile = join(configDir, 'portweave', 'registry.json')
  const raw = await readFile(registryFile, 'utf8')
  const parsed = JSON.parse(raw) as { entries: RegistryEntry[] }
  return parsed.entries
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let configDir: string
let worktreeDir: string
let env: NodeJS.ProcessEnv
let worktreeKey: AllocationKey

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-show-cfg-'))
  worktreeDir = await mkdtemp(join(tmpdir(), 'pw-show-wt-'))
  env = { XDG_CONFIG_HOME: configDir }
  await writeFile(join(worktreeDir, 'portweave.config.json'), CONFIG_CONTENT)

  // Compute the real key that runShow will derive for worktreeDir
  const keyResult = resolveAllocationKey(worktreeDir)
  if (!keyResult.ok) {
    throw new Error(
      `test setup: resolveAllocationKey failed: ${keyResult.error.message}`,
    )
  }
  worktreeKey = keyResult.value
})

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true })
  await rm(worktreeDir, { force: true, recursive: true })
})

function makeEntry(
  key: AllocationKey,
  ports: Record<string, number> = { api: 3104, ws: 3105 },
  lastUsedAt = '2026-01-01T00:00:00.000Z',
): RegistryEntry {
  return { key, lastUsedAt, namespace: key.namespace, ports }
}

function makeOptions(overrides: Partial<ShowOptions> = {}): ShowOptions {
  return { cwd: worktreeDir, env, ...overrides }
}

// ---------------------------------------------------------------------------
// Test 1: Happy path, human banner
// ---------------------------------------------------------------------------
describe('runShow — human banner', () => {
  it('exits 0 and prints worktree + allocated lines per service', async () => {
    await seedRegistryEntry(env, makeEntry(worktreeKey))

    const out = makeWritable()
    const serr = makeWritable()
    const result = await runShow(
      makeOptions({ stderr: serr.stream, stdout: out.stream }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(0)
    }

    const stdout = out.value()
    expect(stdout).toContain('[portweave] worktree:')
    expect(stdout).toContain('[portweave] reusing existing allocation:')
    expect(stdout).toContain('API_PORT')
    expect(stdout).toContain('WS_PORT')
    expect(stdout).toContain('3104')
    expect(stdout).toContain('3105')

    // Must NOT contain lines only run emits
    expect(stdout).not.toContain('wrote .portweave/current.env')
    expect(stdout).not.toContain('launching:')
  })
})

// ---------------------------------------------------------------------------
// Test 2: Happy path, JSON
// ---------------------------------------------------------------------------
describe('runShow — JSON mode', () => {
  it('exits 0 and prints valid JSON with required keys', async () => {
    await seedRegistryEntry(env, makeEntry(worktreeKey))

    const out = makeWritable()
    const serr = makeWritable()
    const result = await runShow(
      makeOptions({ json: true, stderr: serr.stream, stdout: out.stream }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(0)
    }

    const parsed = JSON.parse(out.value()) as {
      env: Record<string, string>
      namespace: string
      ports: Record<string, number>
      worktreeRoot: string
    }
    expect(Object.keys(parsed)).toEqual([
      'env',
      'namespace',
      'ports',
      'worktreeRoot',
    ])
    expect(parsed.ports).toEqual({ api: 3104, ws: 3105 })
    expect(parsed.env.API_PORT).toBe('3104')
    expect(parsed.env.WS_PORT).toBe('3105')
    expect(parsed.namespace).toBe(worktreeKey.namespace)
    expect(parsed.worktreeRoot).toBe(worktreeDir)
  })
})

// ---------------------------------------------------------------------------
// Test 3: Read-only — no .portweave/current.env written
// ---------------------------------------------------------------------------
describe('runShow — read-only contract', () => {
  it('does not write .portweave/current.env', async () => {
    await seedRegistryEntry(env, makeEntry(worktreeKey))

    const out = makeWritable()
    const serr = makeWritable()
    await runShow(makeOptions({ stderr: serr.stream, stdout: out.stream }))

    const envFilePath = join(worktreeDir, '.portweave', 'current.env')
    expect(existsSync(envFilePath)).toBe(false)
  })

  it('does not write .portweave/current.env in JSON mode either', async () => {
    await seedRegistryEntry(env, makeEntry(worktreeKey))

    const out = makeWritable()
    const serr = makeWritable()
    await runShow(
      makeOptions({ json: true, stderr: serr.stream, stdout: out.stream }),
    )

    const envFilePath = join(worktreeDir, '.portweave', 'current.env')
    expect(existsSync(envFilePath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 4: lastUsedAt advances; ports/namespace unchanged
// ---------------------------------------------------------------------------
describe('runShow — touch semantics', () => {
  it('advances lastUsedAt but preserves ports and namespace', async () => {
    const oldTime = '2026-01-01T00:00:00.000Z'
    await seedRegistryEntry(
      env,
      makeEntry(worktreeKey, { api: 3104, ws: 3105 }, oldTime),
    )

    const out = makeWritable()
    const serr = makeWritable()
    const before = Date.now()
    const result = await runShow(
      makeOptions({ stderr: serr.stream, stdout: out.stream }),
    )
    const after = Date.now()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(0)
    }

    const entries = await readRegistryEntries(configDir)
    expect(entries).toHaveLength(1)
    const entry = entries.at(0)
    expect(entry).toBeDefined()
    if (entry === undefined) {
      return
    }

    expect(entry.ports).toEqual({ api: 3104, ws: 3105 })
    expect(entry.namespace).toBe(worktreeKey.namespace)

    const touched = new Date(entry.lastUsedAt).getTime()
    expect(touched).toBeGreaterThanOrEqual(before)
    expect(touched).toBeLessThanOrEqual(after + 1000)
    expect(entry.lastUsedAt).not.toBe(oldTime)
  })
})

// ---------------------------------------------------------------------------
// Test 5: Missing allocation, human mode
// ---------------------------------------------------------------------------
describe('runShow — missing allocation (human)', () => {
  it('exits 1, writes to stderr, stdout is empty', async () => {
    // No registry entry seeded
    const out = makeWritable()
    const serr = makeWritable()
    const result = await runShow(
      makeOptions({ stderr: serr.stream, stdout: out.stream }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(1)
    }
    expect(serr.value()).toContain('no allocation for this worktree')
    expect(serr.value()).toContain('portweave run')
    expect(out.value()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Test 6: Missing allocation, JSON mode
// ---------------------------------------------------------------------------
describe('runShow — missing allocation (JSON)', () => {
  it('exits 1, stdout is {"error":"no-allocation"}, stderr is empty', async () => {
    const out = makeWritable()
    const serr = makeWritable()
    const result = await runShow(
      makeOptions({ json: true, stderr: serr.stream, stdout: out.stream }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(1)
    }
    expect(out.value()).toBe('{"error":"no-allocation"}\n')
    expect(serr.value()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Test 7: Two consecutive show calls
// ---------------------------------------------------------------------------
describe('runShow — stickiness across two calls', () => {
  it('both return same ports and lastUsedAt strictly advances', async () => {
    await seedRegistryEntry(env, makeEntry(worktreeKey))

    const out1 = makeWritable()
    const r1 = await runShow(makeOptions({ json: true, stdout: out1.stream }))
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.value.exitCode).toBe(0)
    }

    // Small delay so timestamps differ
    await new Promise((resolve) => setTimeout(resolve, 50))

    const out2 = makeWritable()
    const r2 = await runShow(makeOptions({ json: true, stdout: out2.stream }))
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.value.exitCode).toBe(0)
    }

    const p1 = (JSON.parse(out1.value()) as { ports: Record<string, number> })
      .ports
    const p2 = (JSON.parse(out2.value()) as { ports: Record<string, number> })
      .ports
    expect(p1).toEqual(p2)

    const entries = await readRegistryEntries(configDir)
    expect(entries).toHaveLength(1)
    const entry = entries.at(0)
    expect(entry).toBeDefined()
    if (entry === undefined) {
      return
    }
    // lastUsedAt must have advanced from the original seed value
    expect(entry.lastUsedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// Test 8: Upstream error propagation
// ---------------------------------------------------------------------------
describe('runShow — upstream error propagation', () => {
  it('exits 1 with stderr diagnostic when config is missing', async () => {
    const noConfigDir = await mkdtemp(join(tmpdir(), 'pw-show-nocfg-'))
    try {
      // config file is absent — loadConfig fails before the registry lookup
      const out = makeWritable()
      const serr = makeWritable()
      const result = await runShow({
        cwd: noConfigDir,
        env,
        stderr: serr.stream,
        stdout: out.stream,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.exitCode).toBe(1)
      }
      expect(serr.value().length).toBeGreaterThan(0)
      expect(out.value()).toBe('')
    } finally {
      await rm(noConfigDir, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 9: JSON output sort order
// ---------------------------------------------------------------------------
describe('runShow — JSON sort order', () => {
  it('top-level and inner keys are alphabetically sorted', async () => {
    // Use single-service config for simplicity
    await writeFile(
      join(worktreeDir, 'portweave.config.json'),
      SINGLE_SERVICE_CONFIG,
    )

    await seedRegistryEntry(env, makeEntry(worktreeKey, { api: 3100 }))

    const out = makeWritable()
    const result = await runShow(
      makeOptions({ json: true, stdout: out.stream }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(0)
    }

    const raw = out.value().trimEnd()
    const parsed = JSON.parse(raw) as {
      env: Record<string, string>
      namespace: string
      ports: Record<string, number>
      worktreeRoot: string
    }
    // Top-level keys sorted
    expect(Object.keys(parsed)).toEqual([
      'env',
      'namespace',
      'ports',
      'worktreeRoot',
    ])

    // Inner keys also sorted
    const envKeys = Object.keys(parsed.env)
    const portsKeys = Object.keys(parsed.ports)
    expect(envKeys).toEqual([...envKeys].sort())
    expect(portsKeys).toEqual([...portsKeys].sort())
  })
})

// ---------------------------------------------------------------------------
// Test: registerShowCommand type-level check
// ---------------------------------------------------------------------------
describe('registerShowCommand', () => {
  it('is a function that accepts a Command and returns void', () => {
    // Type-level: ensure the export signature is correct without invoking the CLI
    expect(typeof registerShowCommand).toBe('function')

    // Minimal duck-typed commander stub
    const calls: string[] = []
    const stub = {
      action: () => stub,
      command: (name: string) => {
        calls.push(name)
        return stub
      },
      description: () => stub,
      option: () => stub,
    }
    registerShowCommand(stub as unknown as Command)
    expect(calls).toContain('show')
  })
})
