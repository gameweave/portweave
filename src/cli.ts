#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { PortweaveError } from './errors.ts'
import { registerPanelCommand } from './cli/panel.ts'
import { registerPruneCommand } from './cli/prune.ts'
import { registerRunCommand } from './cli/run.ts'
import { registerShowCommand } from './cli/show.ts'
import { registerSlotsCommand } from './cli/slots.ts'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

export function buildCli(): Command {
  const program = new Command('portweave')

  program
    .version(pkg.version, '-V, --version', 'output the version number')
    .description(
      'Zero-thought, conflict-free local-dev port allocation across projects and git worktrees.',
    )
    .enablePositionalOptions()
    .option('--config <path>', 'path to portweave config file')
    .option('--count <n>', 'number of ports to allocate (anonymous mode)')
    .option(
      '--primary-only',
      'with "run": do nothing (exit 0) unless this is the primary worktree',
    )
    .option('--verbose', 'print additional diagnostic output')

  registerRunCommand(program)
  registerShowCommand(program)
  registerSlotsCommand(program)
  registerPruneCommand(program)
  registerPanelCommand(program)

  return program
}

export async function main(
  argv: readonly string[] = process.argv,
): Promise<number> {
  const program = buildCli()

  try {
    await program.parseAsync(argv)
    const ec = process.exitCode
    return typeof ec === 'number' ? ec : 0
  } catch (caught: unknown) {
    if (caught instanceof PortweaveError) {
      process.stderr.write(
        `[portweave] error: ${caught.message} (${caught.code})\n`,
      )
    } else if (caught instanceof Error) {
      process.stderr.write(`[portweave] error: ${caught.message}\n`)
      const verbose = argv.includes('--verbose')
      if (verbose && caught.stack !== undefined) {
        process.stderr.write(caught.stack + '\n')
      }
    } else {
      process.stderr.write(`[portweave] error: unknown error\n`)
    }
    return 1
  }
}

/**
 * Is this module the process entry point?
 *
 * `import.meta.main` is the clean answer but only exists on Node 24.2+. On an
 * older runtime it is `undefined`, so a bare `if (import.meta.main)` skipped
 * `main()` and **every command exited 0 with no output at all** — identical to
 * success from a caller's point of view. That is the same failure class as the
 * symlink bug this guard already had to fix once, and it cost a consumer a long
 * debugging session: a wrapper script captured empty stdout with exit 0 and had
 * no way to tell that portweave had simply never run.
 *
 * The fallback compares realpaths rather than sniffing a version, because the
 * hazard it has to survive is the symlink case: `import.meta.url` is already
 * resolved, while `argv[1]` is the unresolved invocation path — the standard npm
 * bin link (`node_modules/.bin/portweave` -> `dist/cli.js`), a global install,
 * or a symlinked prefix such as macOS `/tmp` -> `/private/tmp`. Comparing the
 * two directly (the original bug) never matched. Both cases are covered by
 * src/__tests__/cli.test.ts.
 */
export function isProcessEntry(
  metaMain: boolean | undefined,
  metaUrl: string,
  argv1: string | undefined,
): boolean {
  if (typeof metaMain === 'boolean') {
    return metaMain
  }
  if (argv1 === undefined) {
    return false
  }
  try {
    return realpathSync(argv1) === fileURLToPath(metaUrl)
  } catch {
    // argv[1] may not exist on disk (an eval/-e invocation); not the entry.
    return false
  }
}

if (isProcessEntry(import.meta.main, import.meta.url, process.argv[1])) {
  void main().then((code) => {
    process.exit(code)
  })
}
