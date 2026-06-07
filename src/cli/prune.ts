import type { Command } from 'commander'
import type { PortweaveError } from '../errors.ts'
import { ok, type Result } from '../result.ts'
import { pruneAllocation } from '../panel/prune.ts'
import { resolveAllocationKey } from '../worktree/key.ts'
import { writeOut } from './banner.ts'

export interface PruneOptions {
  cwd?: string
  /**
   * Test-injection override for process.env. Scoped XDG_CONFIG_HOME and other
   * env vars flow through to `withRegistry`. Defaults to `process.env` in
   * production. See `src/cli/__tests__/prune.test.ts` for usage.
   */
  env?: NodeJS.ProcessEnv
  /** Prune a different worktree without cd-ing into it. */
  path?: string
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
}

export interface PruneOutcome {
  readonly exitCode: number
}

// Reuses the CLI_NO_ALLOCATION (PW0603) semantics — same shape as show's
// no-allocation path. Diagnostics go to stderr (decision-log #27).
const NO_ALLOCATION_MSG =
  '[portweave] no allocation for this worktree — nothing to prune\n'

export async function runPrune(
  options: PruneOptions,
): Promise<Result<PruneOutcome, PortweaveError>> {
  const cwd = options.cwd ?? process.cwd()
  const processEnv = options.env ?? process.env
  const stderr = options.stderr ?? process.stderr

  const keyResult = resolveAllocationKey(options.path ?? cwd)
  if (!keyResult.ok) {
    await writeOut(stderr, `[portweave] ${keyResult.error.message}\n`)
    return ok({ exitCode: 1 })
  }
  const key = keyResult.value

  const pruneResult = await pruneAllocation(key, processEnv)
  if (!pruneResult.ok) {
    await writeOut(stderr, `[portweave] ${pruneResult.error.message}\n`)
    return ok({ exitCode: 1 })
  }

  if (!pruneResult.value.removed) {
    await writeOut(stderr, NO_ALLOCATION_MSG)
    return ok({ exitCode: 1 })
  }

  await writeOut(
    stderr,
    `[portweave] pruned allocation for ${key.worktreeRoot}\n`,
  )
  return ok({ exitCode: 0 })
}

export function registerPruneCommand(program: Command): void {
  program
    .command('prune')
    .description(
      'Remove the port allocation for the current worktree from the registry',
    )
    .option(
      '--path <dir>',
      'prune the allocation for another worktree directory',
    )
    .action(async (opts: { path?: string }) => {
      const result = await runPrune({ path: opts.path })
      if (!result.ok) {
        process.stderr.write(`[portweave] ${result.error.message}\n`)
        process.exit(1)
      }
      process.exit(result.value.exitCode)
    })
}
