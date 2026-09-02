import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isProcessEntry } from '../cli.ts'

// End-to-end test of the built CLI's process entry point.
//
// The entry-point guard in src/cli.ts (`if (import.meta.main)`) only fires when
// dist/cli.js is the actual process entry, so it cannot be reached by the
// in-process runCommand tests in src/cli/__tests__/run.test.ts — only by
// spawning the built binary as a subprocess.
//
// Regression: when the CLI was reached through a symlink — the standard npm bin
// link (node_modules/.bin/portweave -> dist/cli.js), a global install, or a
// symlinked path such as macOS /tmp -> /private/tmp — the old guard
// (`import.meta.url === ` + "`file://${process.argv[1]}`") never matched, so
// main() never ran and `portweave run` exited 0 with completely empty
// stdout/stderr. These tests invoke the binary through a symlink to lock that in.

// Symlink + POSIX-bin semantics; skipped on Windows where symlinks need elevation.
const skipOnWindows = process.platform === 'win32'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const builtCli = join(repoRoot, 'dist', 'cli.js')

let workDir = ''

beforeAll(() => {
  // Build into the real dist/ (not a throwaway dir): cli.js does
  // require('../package.json'), which only resolves when emitted under dist/.
  const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  execFileSync(process.execPath, [tsc, '--project', 'tsconfig.build.json'], {
    cwd: repoRoot,
    stdio: 'pipe',
  })
  if (!existsSync(builtCli)) {
    throw new Error(`build did not produce ${builtCli}`)
  }
  workDir = mkdtempSync(join(tmpdir(), 'portweave-cli-e2e-'))
}, 60_000)

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { force: true, recursive: true })
  }
})

function makeGitRepo(): string {
  const dir = mkdtempSync(join(workDir, 'repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(
    join(dir, 'portweave.config.json'),
    JSON.stringify({ services: { api: { envVar: 'API_PORT' } } }),
  )
  return dir
}

// Spawn the built CLI *through a symlink* (mimicking node_modules/.bin/portweave)
// with an isolated registry so the real ~/.config/portweave is untouched.
function runViaSymlink(
  childArgs: readonly string[],
): ReturnType<typeof spawnSync> {
  const repo = makeGitRepo()
  const xdg = mkdtempSync(join(workDir, 'xdg-'))
  const linkDir = mkdtempSync(join(workDir, 'bin-'))
  const link = join(linkDir, 'portweave')
  symlinkSync(builtCli, link)
  return spawnSync(process.execPath, [link, 'run', '--', ...childArgs], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: xdg },
  })
}

describe.skipIf(skipOnWindows)('built CLI entry point (subprocess)', () => {
  it('emits the allocation banner and child output when invoked through a bin symlink', () => {
    const res = runViaSymlink([
      process.execPath,
      '-e',
      "process.stdout.write('PW_CHILD_STDOUT\\n'); process.stderr.write('PW_CHILD_STDERR\\n')",
    ])
    // With the old guard, main() never ran through a symlink and every one of
    // these assertions saw an empty string.
    expect(res.stderr).toContain('[portweave]')
    expect(res.stderr).toContain('API_PORT')
    expect(res.stderr).toContain('PW_CHILD_STDERR')
    expect(res.stdout).toContain('PW_CHILD_STDOUT')
    expect(res.status).toBe(0)
  })

  it('propagates the child exit code through the symlinked bin', () => {
    const res = runViaSymlink([process.execPath, '-e', 'process.exit(7)'])
    // Proves main() ran end to end through the symlink, not just that it printed.
    expect(res.status).toBe(7)
  })
})

describe('isProcessEntry', () => {
  it('trusts import.meta.main when the runtime provides it', () => {
    expect(isProcessEntry(true, 'file:///anything.js', '/other.js')).toBe(true)
    expect(isProcessEntry(false, 'file:///anything.js', '/other.js')).toBe(
      false,
    )
  })

  it('falls back to a realpath comparison when import.meta.main is undefined', () => {
    // Node < 24.2 has no import.meta.main. Without this fallback main() never
    // ran and every command exited 0 with no output.
    const self = fileURLToPath(import.meta.url)
    expect(isProcessEntry(undefined, import.meta.url, self)).toBe(true)
  })

  it('resolves a symlinked argv[1] to the same realpath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-entry-'))
    try {
      const self = fileURLToPath(import.meta.url)
      const link = join(dir, 'linked-entry.ts')
      symlinkSync(self, link)
      expect(isProcessEntry(undefined, import.meta.url, link)).toBe(true)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('is false for an unrelated argv[1], and for none at all', () => {
    expect(
      isProcessEntry(undefined, import.meta.url, '/definitely/other.js'),
    ).toBe(false)
    expect(isProcessEntry(undefined, import.meta.url, undefined)).toBe(false)
  })

  it('is false rather than throwing when argv[1] does not exist on disk', () => {
    expect(
      isProcessEntry(undefined, import.meta.url, '/no/such/path/anywhere.js'),
    ).toBe(false)
  })
})
