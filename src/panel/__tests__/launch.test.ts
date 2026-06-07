import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnLauncher, WhichProbe } from '../launch.ts'
import { launchAt } from '../launch.ts'

interface SpawnCall {
  readonly args: string[]
  readonly cmd: string
}

function recordingSpawn(ok = true): {
  calls: SpawnCall[]
  spawn: SpawnLauncher
} {
  const calls: SpawnCall[] = []
  const spawn: SpawnLauncher = (cmd, args) => {
    calls.push({ args, cmd })
    return { ok }
  }
  return { calls, spawn }
}

const whichNone: WhichProbe = () => false
const whichAll: WhichProbe = () => true
const whichOnly =
  (...present: string[]): WhichProbe =>
  (bin) =>
    present.includes(bin)

// Registers hooks that clear PORTWEAVE_EDITOR before each test and restore the
// original value afterwards, so editor-resolution tests don't leak env state.
function withEditorEnvReset(): void {
  const originalEditor = process.env.PORTWEAVE_EDITOR

  beforeEach(() => {
    delete process.env.PORTWEAVE_EDITOR
  })

  afterEach(() => {
    if (originalEditor === undefined) {
      delete process.env.PORTWEAVE_EDITOR
    } else {
      process.env.PORTWEAVE_EDITOR = originalEditor
    }
  })
}

describe('launchAt unsupported platform', () => {
  it('returns unsupported-platform off macOS without spawning', async () => {
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('terminal', '/repo', {
      platform: 'linux',
      spawn,
    })

    expect(result).toEqual({ launched: false, reason: 'unsupported-platform' })
    expect(calls).toHaveLength(0)
  })

  it('returns unsupported-platform on win32', async () => {
    const result = await launchAt('editor', '/repo', { platform: 'win32' })

    expect(result).toEqual({ launched: false, reason: 'unsupported-platform' })
  })
})

describe('launchAt terminal', () => {
  it('launches the terminal via `open -a Terminal <path>` (argv array)', async () => {
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('terminal', '/home/dev/wt', {
      platform: 'darwin',
      spawn,
      which: whichNone,
    })

    expect(result).toEqual({ launched: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      args: ['-a', 'Terminal', '/home/dev/wt'],
      cmd: 'open',
    })
  })
})

describe('launchAt editor resolution', () => {
  withEditorEnvReset()
  it('honors PORTWEAVE_EDITOR for the editor target', async () => {
    process.env.PORTWEAVE_EDITOR = 'my-editor'
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('editor', '/home/dev/wt', {
      platform: 'darwin',
      spawn,
      // which should never be consulted once PORTWEAVE_EDITOR is set
      which: whichAll,
    })

    expect(result).toEqual({ launched: true })
    expect(calls[0]).toEqual({ args: ['/home/dev/wt'], cmd: 'my-editor' })
  })

  it('ignores an empty PORTWEAVE_EDITOR and falls through to PATH', async () => {
    process.env.PORTWEAVE_EDITOR = ''
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('editor', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichOnly('code'),
    })

    expect(result).toEqual({ launched: true })
    expect(calls[0]).toEqual({ args: ['/wt'], cmd: 'code' })
  })

  it('prefers `code` on PATH when no PORTWEAVE_EDITOR is set', async () => {
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('editor', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichOnly('code', 'cursor'),
    })

    expect(result).toEqual({ launched: true })
    expect(calls[0]).toEqual({ args: ['/wt'], cmd: 'code' })
  })

  it('falls back to `cursor` when only cursor is on PATH', async () => {
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('editor', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichOnly('cursor'),
    })

    expect(result).toEqual({ launched: true })
    expect(calls[0]).toEqual({ args: ['/wt'], cmd: 'cursor' })
  })

  it('falls back to `open -a "Visual Studio Code"` when only open is present', async () => {
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('editor', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichOnly('open'),
    })

    expect(result).toEqual({ launched: true })
    expect(calls[0]).toEqual({
      args: ['-a', 'Visual Studio Code', '/wt'],
      cmd: 'open',
    })
  })

  it('returns no-editor-found when nothing is launchable and never spawns', async () => {
    const { calls, spawn } = recordingSpawn()

    const result = await launchAt('editor', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichNone,
    })

    expect(result).toEqual({ launched: false, reason: 'no-editor-found' })
    expect(calls).toHaveLength(0)
  })
})

describe('launchAt failure modes', () => {
  withEditorEnvReset()
  it('surfaces launch-failed when the spawn reports failure', async () => {
    const { spawn } = recordingSpawn(false)

    const result = await launchAt('terminal', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichNone,
    })

    expect(result).toEqual({ launched: false, reason: 'launch-failed' })
  })

  it('never throws — a throwing spawn collapses to launch-failed', async () => {
    const spawn: SpawnLauncher = () => {
      throw new Error('spawn boom')
    }

    const result = await launchAt('terminal', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichNone,
    })

    expect(result).toEqual({ launched: false, reason: 'launch-failed' })
  })

  it('treats a rejected spawn promise as launch-failed', async () => {
    const spawn: SpawnLauncher = () => Promise.reject(new Error('async boom'))

    const result = await launchAt('editor', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichOnly('code'),
    })

    expect(result).toEqual({ launched: false, reason: 'launch-failed' })
  })

  it('awaits an async spawn that resolves ok', async () => {
    const spawn: SpawnLauncher = () => Promise.resolve({ ok: true })

    const result = await launchAt('terminal', '/wt', {
      platform: 'darwin',
      spawn,
      which: whichNone,
    })

    expect(result).toEqual({ launched: true })
  })
})

describe('launchAt argv safety', () => {
  it('passes an argv array, never a shell string, for paths with metacharacters', async () => {
    const spawn = vi.fn<SpawnLauncher>(() => ({ ok: true }))
    const evil = '/wt; rm -rf ~ && echo $(whoami) `id`'

    const result = await launchAt('terminal', evil, {
      platform: 'darwin',
      spawn,
      which: whichNone,
    })

    expect(result).toEqual({ launched: true })
    expect(spawn).toHaveBeenCalledTimes(1)

    const [cmd, args] = spawn.mock.calls[0] ?? []
    // The whole string is a single argv element — not a shell command line —
    // so the metacharacters can never be interpreted by a shell.
    expect(cmd).toBe('open')
    expect(Array.isArray(args)).toBe(true)
    expect(args).toEqual(['-a', 'Terminal', evil])
    // Defensive: nothing was ever handed a concatenated shell string.
    expect(typeof cmd).toBe('string')
    expect(cmd).not.toContain(evil)
  })
})
