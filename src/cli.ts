#!/usr/bin/env node
import { createRequire } from 'node:module'
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

// Entry point when run as a script.
//
// `import.meta.main` (Node 24+) is true only when this module is the process
// entry. The previous check compared `import.meta.url` to `file://${argv[1]}`,
// which silently failed whenever cli.js was reached through a symlink — the
// standard npm bin link (node_modules/.bin/portweave -> dist/cli.js), a global
// install, or a symlinked path (e.g. macOS /tmp -> /private/tmp). import.meta.url
// is the realpath while argv[1] is the unresolved invocation path, so they never
// matched and main() never ran: `portweave run` exited 0 with no output. The
// symlink case is covered by src/__tests__/cli.test.ts.
if (import.meta.main) {
  void main().then((code) => {
    process.exit(code)
  })
}
