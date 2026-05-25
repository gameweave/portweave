import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'

// Runtime tests exercise the full allocate → resolveEnv path, which reads
// XDG_CONFIG_HOME to locate the machine-wide registry. Without isolation
// every test would write into the user's real ~/.config/portweave/registry.json.
//
// Call setupScopedXdg() at the top of a describe block to redirect XDG to a
// per-test temp dir and tear it down afterwards. Matches the isolation
// pattern used in src/cli/__tests__/show.test.ts and __tests__/boardflip-parity.test.ts.

export function setupScopedXdg(): void {
  let savedXdg: string | undefined
  let xdgDir: string | undefined

  beforeEach(async () => {
    savedXdg = process.env.XDG_CONFIG_HOME
    xdgDir = await mkdtemp(join(tmpdir(), 'portweave-runtime-xdg-'))
    process.env.XDG_CONFIG_HOME = xdgDir
  })

  afterEach(async () => {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg
    }
    if (xdgDir !== undefined) {
      await rm(xdgDir, { force: true, recursive: true })
    }
  })
}
