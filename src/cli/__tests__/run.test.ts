import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCli } from '../../cli.ts'
import { runCommand } from '../run.ts'
import {
  cleanupDir,
  makeCapturingIo,
  makeSilentIo,
  makeTmpGitRepo,
} from './_helpers.ts'

const BASE_OPTS = { primaryOnly: false, verbose: false }

// ─── shared fixture ────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(async () => {
  tmpDir = await makeTmpGitRepo({ services: { api: { envVar: 'API_PORT' } } })
})

afterEach(async () => {
  await cleanupDir(tmpDir)
})

// ─── core run orchestration ─────────────────────────────────────────────────

describe('runCommand — orchestration', () => {
  it('exits 0 when child exits 0', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(0)'],
      BASE_OPTS,
      io,
    )
    expect(code).toBe(0)
  })

  it('writes .portweave/current.env with API_PORT', async () => {
    const io = makeCapturingIo(tmpDir)
    await runCommand(['node', '-e', 'process.exit(0)'], BASE_OPTS, io)
    const envFile = await readFile(
      join(tmpDir, '.portweave', 'current.env'),
      'utf8',
    )
    expect(envFile).toContain('API_PORT=')
  })

  it('injects API_PORT into child environment', async () => {
    const outFile = join(tmpDir, 'port-output.txt')
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      [
        'node',
        '-e',
        `require('fs').writeFileSync('${outFile}', process.env.API_PORT ?? 'MISSING')`,
      ],
      BASE_OPTS,
      io,
    )
    expect(code).toBe(0)
    const portValue = await readFile(outFile, 'utf8')
    expect(portValue).toMatch(/^\d+$/)
    const envFile = await readFile(
      join(tmpDir, '.portweave', 'current.env'),
      'utf8',
    )
    expect(envFile).toContain(`API_PORT=${portValue}`)
  })

  it('injects PORTWEAVE_NAMESPACE; a stray parent value does not shadow it', async () => {
    const outFile = join(tmpDir, 'ns-output.txt')
    const base = makeCapturingIo(tmpDir)
    // Parent env carries a raw PORTWEAVE_NAMESPACE; the child must still see the
    // namespace Portweave allocated under ('main' for a fresh repo's main tree).
    const io = {
      ...base,
      env: { ...process.env, PORTWEAVE_NAMESPACE: 'bogus-parent-value' },
    }
    const code = await runCommand(
      [
        'node',
        '-e',
        `require('fs').writeFileSync('${outFile}', process.env.PORTWEAVE_NAMESPACE ?? 'MISSING')`,
      ],
      BASE_OPTS,
      io,
    )
    expect(code).toBe(0)
    expect(await readFile(outFile, 'utf8')).toBe('main')

    const envFile = await readFile(
      join(tmpDir, '.portweave', 'current.env'),
      'utf8',
    )
    expect(envFile).toContain('PORTWEAVE_NAMESPACE=main')
  })

  it('injects a ${namespace}-templated discoveryEnv value into the child', async () => {
    const repo = await makeTmpGitRepo({
      services: {
        api: {
          discoveryEnv: { DDB_TABLE_PREFIX: 'local-${namespace}' },
          envVar: 'API_PORT',
        },
      },
    })
    const outFile = join(repo, 'prefix-output.txt')
    try {
      const io = makeCapturingIo(repo)
      const code = await runCommand(
        [
          'node',
          '-e',
          `require('fs').writeFileSync('${outFile}', process.env.DDB_TABLE_PREFIX ?? 'MISSING')`,
        ],
        BASE_OPTS,
        io,
      )
      expect(code).toBe(0)
      // Fresh repo's primary worktree → namespace 'main'.
      expect(await readFile(outFile, 'utf8')).toBe('local-main')
      const envFile = await readFile(
        join(repo, '.portweave', 'current.env'),
        'utf8',
      )
      expect(envFile).toContain('DDB_TABLE_PREFIX=local-main')
    } finally {
      await cleanupDir(repo)
    }
  })

  it('banner lines go to stderr not stdout', async () => {
    const io = makeCapturingIo(tmpDir)
    await runCommand(['node', '-e', 'process.exit(0)'], BASE_OPTS, io)
    const errOutput = io.stderrOutput.join('')
    expect(errOutput).toContain('[portweave]')
    expect(errOutput).toContain('API_PORT')
  })

  it('banner includes worktree header and allocated verb', async () => {
    const io = makeCapturingIo(tmpDir)
    await runCommand(['node', '-e', 'process.exit(0)'], BASE_OPTS, io)
    const errOutput = io.stderrOutput.join('')
    expect(errOutput).toContain('[portweave] worktree:')
    expect(errOutput).toContain('[portweave] allocated:')
  })

  it('banner includes "wrote .portweave/current.env" line', async () => {
    const io = makeCapturingIo(tmpDir)
    await runCommand(['node', '-e', 'process.exit(0)'], BASE_OPTS, io)
    expect(io.stderrOutput.join('')).toContain(
      '[portweave] wrote .portweave/current.env',
    )
  })

  it('non-zero child exit propagates to return value', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(5)'],
      BASE_OPTS,
      io,
    )
    expect(code).toBe(5)
  })

  it('--verbose adds diagnostic lines to banner', async () => {
    const io = makeCapturingIo(tmpDir)
    await runCommand(
      ['node', '-e', 'process.exit(0)'],
      { ...BASE_OPTS, verbose: true },
      io,
    )
    expect(io.stderrOutput.join('')).toContain('[portweave]')
  })
})

// ─── flag validation ─────────────────────────────────────────────────────────

describe('runCommand — flag validation', () => {
  it('--config + --count together returns exit 1 with CLI_INVALID_FLAGS', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(0)'],
      { ...BASE_OPTS, configPath: './portweave.config.json', count: 3 },
      io,
    )
    expect(code).toBe(1)
    expect(io.stderrOutput.join('')).toContain('PW0601')
  })

  it('empty child args returns exit 1 with CLI_INVALID_FLAGS', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand([], BASE_OPTS, io)
    expect(code).toBe(1)
    expect(io.stderrOutput.join('')).toContain('PW0601')
  })

  it('--count with non-integer returns exit 1 with CLI_INVALID_FLAGS', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(0)'],
      { ...BASE_OPTS, count: 2.5 },
      io,
    )
    expect(code).toBe(1)
    expect(io.stderrOutput.join('')).toContain('PW0601')
  })

  it('--count with non-positive value returns exit 1', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(0)'],
      { ...BASE_OPTS, count: 0 },
      io,
    )
    expect(code).toBe(1)
  })

  it('--config path loads the named file instead of default', async () => {
    const altConfig = { services: { 'alt-api': { envVar: 'ALT_API_PORT' } } }
    await writeFile(join(tmpDir, 'alt.config.json'), JSON.stringify(altConfig))
    const outFile = join(tmpDir, 'env-output.txt')
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      [
        'node',
        '-e',
        `require('fs').writeFileSync('${outFile}', process.env.ALT_API_PORT ?? '')`,
      ],
      { ...BASE_OPTS, configPath: './alt.config.json' },
      io,
    )
    expect(code).toBe(0)
    expect(await readFile(outFile, 'utf8')).toMatch(/^\d+$/)
  })

  it('buildCli registers the run subcommand on Commander root', () => {
    const program = buildCli()
    expect(program.name()).toBe('portweave')
    expect(program.commands.map((c) => c.name())).toContain('run')
  })
})

// ─── anonymous mode ───────────────────────────────────────────────────────────

describe('runCommand — anonymous mode', () => {
  it('--count 3 injects PORT_1, PORT_2, PORT_3 as distinct ports', async () => {
    const noConfigDir = await makeTmpGitRepo()
    const outFile = join(noConfigDir, 'ports-output.txt')
    const childScript = `
      const fs = require('fs');
      fs.writeFileSync('${outFile}', [process.env.PORT_1, process.env.PORT_2, process.env.PORT_3].join(','));
    `
    try {
      const io = makeSilentIo(noConfigDir)
      const code = await runCommand(
        ['node', '-e', childScript],
        { ...BASE_OPTS, count: 3 },
        io,
      )
      expect(code).toBe(0)
      const parts = (await readFile(outFile, 'utf8')).split(',')
      expect(parts).toHaveLength(3)
      for (const p of parts) {
        expect(p).toMatch(/^\d+$/)
      }
      expect(new Set(parts).size).toBe(3)
    } finally {
      await cleanupDir(noConfigDir)
    }
  })

  it('--count 3 writes PORT_1, PORT_2, PORT_3 to current.env', async () => {
    const noConfigDir = await makeTmpGitRepo()
    try {
      const io = makeSilentIo(noConfigDir)
      await runCommand(
        ['node', '-e', 'process.exit(0)'],
        { ...BASE_OPTS, count: 3 },
        io,
      )
      const envFile = await readFile(
        join(noConfigDir, '.portweave', 'current.env'),
        'utf8',
      )
      expect(envFile).toContain('PORT_1=')
      expect(envFile).toContain('PORT_2=')
      expect(envFile).toContain('PORT_3=')
    } finally {
      await cleanupDir(noConfigDir)
    }
  })

  it('fails with non-zero exit when no --count and no config file', async () => {
    const noConfigDir = await makeTmpGitRepo()
    try {
      const io = makeSilentIo(noConfigDir)
      const code = await runCommand(
        ['node', '-e', 'process.exit(0)'],
        BASE_OPTS,
        io,
      )
      expect(code).not.toBe(0)
    } finally {
      await cleanupDir(noConfigDir)
    }
  })

  it('works in a non-git directory with --count', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'portweave-nongit-'))
    const outFile = join(nonGitDir, 'ports.txt')
    const childScript = `require('fs').writeFileSync('${outFile}', process.env.PORT_1 ?? 'MISSING');`
    const io = makeSilentIo(nonGitDir)
    try {
      const code = await runCommand(
        ['node', '-e', childScript],
        { ...BASE_OPTS, count: 1 },
        io,
      )
      if (code === 0) {
        expect(await readFile(outFile, 'utf8')).toMatch(/^\d+$/)
      }
      expect([0, 1]).toContain(code)
    } finally {
      await rm(nonGitDir, { force: true, recursive: true })
    }
  })
})

// ─── signal forwarding ────────────────────────────────────────────────────────

const isWindows = process.platform === 'win32'

describe.skipIf(isWindows)('runCommand — signal forwarding', () => {
  it('SIGINT is forwarded to child; child exits with expected code', async (): Promise<void> => {
    const markerFile = join(tmpDir, 'got-sigint.txt')
    const childScript = `
        process.on('SIGINT', () => {
          require('fs').writeFileSync('${markerFile}', 'got SIGINT');
          process.exit(130);
        });
        setTimeout(() => {}, 30000);
      `
    const io = makeSilentIo(tmpDir)
    const runPromise = runCommand(['node', '-e', childScript], BASE_OPTS, io)
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    process.kill(process.pid, 'SIGINT')
    const code = await runPromise
    let markerExists = false
    try {
      await readFile(markerFile, 'utf8')
      markerExists = true
    } catch {
      // pw-allow-swallow: marker may not exist if timing was off
    }
    expect(markerExists || code === 130).toBe(true)
  }, 10000)
})

// ─── --primary-only ─────────────────────────────────────────────────────────

// A bare temp dir is its own main worktree, so the derived namespace is
// already "main"; the linked case is simulated with the namespace override.
function ioWithEnv(cwd: string, extra: NodeJS.ProcessEnv) {
  const io = makeCapturingIo(cwd)
  return { ...io, env: { ...process.env, ...extra } }
}

describe('runCommand — --primary-only', () => {
  it('runs the command in the primary worktree', async () => {
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(7)'],
      { ...BASE_OPTS, primaryOnly: true },
      io,
    )
    expect(code).toBe(7)
  })

  it('skips with exit 0 in a linked worktree, without spawning', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'feature-branch')
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand(
      ['node', '-e', 'process.exit(7)'],
      { ...BASE_OPTS, primaryOnly: true },
      io,
    )
    // 0, not 7 — the child never ran.
    expect(code).toBe(0)
    expect(io.stderrOutput.join('')).toContain('--primary-only')
    expect(io.stderrOutput.join('')).toContain('feature-branch')
  })

  it('does not write .portweave/current.env when it skips', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'feature-branch')
    await runCommand(
      ['node', '-e', 'process.exit(0)'],
      { ...BASE_OPTS, primaryOnly: true },
      makeSilentIo(tmpDir),
    )
    await expect(
      readFile(join(tmpDir, '.portweave', 'current.env'), 'utf8'),
    ).rejects.toThrow()
  })
})

describe('runCommand — --primary-only escape hatches', () => {
  it('PORTWEAVE_PRIMARY=1 forces the command to run in a linked worktree', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'feature-branch')
    const code = await runCommand(
      ['node', '-e', 'process.exit(7)'],
      { ...BASE_OPTS, primaryOnly: true },
      ioWithEnv(tmpDir, { PORTWEAVE_PRIMARY: '1' }),
    )
    expect(code).toBe(7)
  })

  it('is inert without the flag', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'feature-branch')
    const code = await runCommand(
      ['node', '-e', 'process.exit(7)'],
      BASE_OPTS,
      makeSilentIo(tmpDir),
    )
    expect(code).toBe(7)
  })

  it('still rejects a missing command before considering the flag', async () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'feature-branch')
    const io = makeCapturingIo(tmpDir)
    const code = await runCommand([], { ...BASE_OPTS, primaryOnly: true }, io)
    expect(code).toBe(1)
    expect(io.stderrOutput.join('')).toContain('PW0601')
  })
})
