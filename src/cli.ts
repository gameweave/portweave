#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { PortweaveError } from './errors.ts'
import { registerRunCommand } from './cli/run.ts'

// show-command: stub registration point for Wave B3's parallel worktree.
// registerShowCommand(program) will be called here once that spec lands.
// The function is declared here as a no-op placeholder so the integration
// merge is conflict-free.
function registerShowCommand(program: Command): void {
  program
    .command('show')
    .description('Show the current port allocation (coming soon)')
    .action(() => {
      process.stderr.write('[portweave] show command is not yet implemented\n')
      process.exitCode = 1
    })
}

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
    .option('--verbose', 'print additional diagnostic output')

  registerRunCommand(program)
  registerShowCommand(program)

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

// Entry point when run as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => {
    process.exit(code)
  })
}
