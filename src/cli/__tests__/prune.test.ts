import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Command } from 'commander'
import { resolveAllocationKey } from '../../worktree/key.ts'
import type { AllocationKey } from '../../worktree/key.ts'
import { type PruneOptions, registerPruneCommand, runPrune } from '../prune.ts'
import {
  expectExitCode,
  makeEntry,
  readEntries,
  runCapture,
  seedEntry,
} from './_helpers.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeGitWorktree(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pw-prune-wt-'))
  execFileSync('git', ['init'], { cwd: dir })
  return dir
}

function keyFor(dir: string): AllocationKey {
  const keyResult = resolveAllocationKey(dir)
  if (!keyResult.ok) {
    throw new Error(
      `test setup: resolveAllocationKey failed: ${keyResult.error.message}`,
    )
  }
  return keyResult.value
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let configDir: string
let worktreeDir: string
let env: NodeJS.ProcessEnv
let worktreeKey: AllocationKey

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-prune-cfg-'))
  worktreeDir = await makeGitWorktree()
  env = { XDG_CONFIG_HOME: configDir }
  worktreeKey = keyFor(worktreeDir)
})

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true })
  await rm(worktreeDir, { force: true, recursive: true })
})

function makeOptions(overrides: Partial<PruneOptions> = {}): PruneOptions {
  return { cwd: worktreeDir, env, ...overrides }
}

// ---------------------------------------------------------------------------
// Test 1: Happy path — prunes the cwd's allocation
// ---------------------------------------------------------------------------
describe('runPrune — happy path', () => {
  it('removes the targeted entry, exits 0, confirmation on stderr', async () => {
    await seedEntry(env, makeEntry(worktreeKey))

    const { result, serr } = await runCapture((streams) =>
      runPrune(makeOptions(streams)),
    )

    expectExitCode(result, 0)

    expect(serr.value()).toContain('pruned allocation for')
    expect(serr.value()).toContain(worktreeDir)

    // A follow-up read shows the entry gone.
    const entries = await readEntries(env)
    expect(entries).toHaveLength(0)
  })

  it('leaves valid sibling entries unchanged', async () => {
    const siblingDir = await makeGitWorktree()
    try {
      const siblingKey = keyFor(siblingDir)
      await seedEntry(env, makeEntry(worktreeKey))
      await seedEntry(env, makeEntry(siblingKey, { api: 3200 }))

      const result = await runPrune(makeOptions())
      expectExitCode(result, 0)

      const entries = await readEntries(env)
      expect(entries).toHaveLength(1)
      expect(entries.at(0)?.key.worktreeRoot).toBe(siblingKey.worktreeRoot)
    } finally {
      await rm(siblingDir, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 2: --path targets another worktree directory
// ---------------------------------------------------------------------------
describe('runPrune — --path targeting', () => {
  it('prunes the entry for the --path directory, not the cwd', async () => {
    const otherDir = await makeGitWorktree()
    try {
      const otherKey = keyFor(otherDir)
      await seedEntry(env, makeEntry(worktreeKey))
      await seedEntry(env, makeEntry(otherKey, { api: 3200 }))

      // cwd points at worktreeDir, but --path targets otherDir.
      const { result, serr } = await runCapture((streams) =>
        runPrune(makeOptions({ ...streams, path: otherDir })),
      )

      expectExitCode(result, 0)
      expect(serr.value()).toContain(otherDir)

      const entries = await readEntries(env)
      expect(entries).toHaveLength(1)
      expect(entries.at(0)?.key.worktreeRoot).toBe(worktreeKey.worktreeRoot)
    } finally {
      await rm(otherDir, { force: true, recursive: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 3: No matching allocation → exit 1
// ---------------------------------------------------------------------------
describe('runPrune — no allocation', () => {
  it('exits 1 with a no-allocation message and writes nothing else', async () => {
    // No registry entry seeded.
    const { out, result, serr } = await runCapture((streams) =>
      runPrune(makeOptions(streams)),
    )

    expectExitCode(result, 1)
    expect(serr.value()).toContain('no allocation for this worktree')
    expect(serr.value()).toContain('nothing to prune')
    expect(out.value()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Test 4: Works with no panel server running (it hits withRegistry directly)
// ---------------------------------------------------------------------------
describe('runPrune — server-independent', () => {
  it('prunes against the registry with no server process involved', async () => {
    await seedEntry(env, makeEntry(worktreeKey))

    // No server is started in this test; runPrune talks to withRegistry only.
    const result = await runPrune(makeOptions())
    expectExitCode(result, 0)

    const entries = await readEntries(env)
    expect(entries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Test 5: registerPruneCommand wiring (duck-typed commander stub)
// ---------------------------------------------------------------------------
describe('registerPruneCommand', () => {
  it('registers the prune command and its --path option', () => {
    expect(typeof registerPruneCommand).toBe('function')

    const commandCalls: string[] = []
    const optionCalls: string[] = []
    const stub = {
      action: () => stub,
      command: (name: string) => {
        commandCalls.push(name)
        return stub
      },
      description: () => stub,
      option: (flags: string) => {
        optionCalls.push(flags)
        return stub
      },
    }
    registerPruneCommand(stub as unknown as Command)
    expect(commandCalls).toContain('prune')
    expect(optionCalls.some((f) => f.startsWith('--path'))).toBe(true)
  })
})
