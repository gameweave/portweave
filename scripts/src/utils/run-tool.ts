import { spawnSync, type SpawnSyncOptions } from 'node:child_process'

interface RunToolOptions {
  args: string[]
  cmd: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  label: string
}

/**
 * Run a tool synchronously, inheriting stdio. Prints a one-line header
 * and exits the parent process with the child's exit code on failure.
 * Used by the thin bin/<check>.ts wrappers.
 */
export function runTool(opts: RunToolOptions): void {
  const { args, cmd, cwd, env, label } = opts
  process.stdout.write(`[portweave] ${label}: ${cmd} ${args.join(' ')}\n`)
  const spawnOptions: SpawnSyncOptions = {
    stdio: 'inherit',
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
  }
  const result = spawnSync(cmd, args, spawnOptions)
  if (result.error) {
    process.stderr.write(
      `[portweave] ${label} failed to spawn: ${result.error.message}\n`,
    )
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
