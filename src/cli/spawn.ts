import { spawn } from 'node:child_process'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import type { RunIo } from './run.ts'

export interface SpawnChildOptions {
  env: NodeJS.ProcessEnv
  // io is pre-wired for a future stdio:'pipe' capture mode (e.g. portweave run --capture).
  // With the current stdio:'inherit' the child inherits the parent's file descriptors
  // directly; io.stderr and io.stdout are not written to in the normal path.
  // INVARIANT: do not change stdio:'inherit' to 'pipe' without also routing child
  // output through io.stderr / io.stdout — otherwise output is silently dropped.
  io: Pick<RunIo, 'stderr' | 'stdout'>
  signal?: AbortSignal
}

export interface SpawnChildResult {
  exitCode: null | number
  signal: NodeJS.Signals | null
}

/**
 * Spawns a child process with `stdio: 'inherit'`, forwards SIGINT and SIGTERM,
 * and resolves with the child's exit status.
 *
 * - Resolves with `ok({ exitCode, signal })` on any child exit (including non-zero).
 * - Returns `err(PortweaveError(CLI_CHILD_SPAWN_FAILED))` if the child fails to start.
 * - If `signal` is provided, aborts by sending SIGTERM to the child when the signal fires.
 */
export function spawnChild(
  argv: readonly string[],
  options: SpawnChildOptions,
): Promise<Result<SpawnChildResult, PortweaveError>> {
  if (argv.length === 0) {
    return Promise.resolve(
      err(
        new PortweaveError(
          PW_ERROR_CODES.CLI_CHILD_SPAWN_FAILED,
          'No command provided to spawnChild',
        ),
      ),
    )
  }

  const [cmd, ...args] = argv

  return new Promise<Result<SpawnChildResult, PortweaveError>>((resolve) => {
    // spawn (not exec) is used intentionally: no shell is involved, so shell
    // metacharacters in argv are inert. Relative-path commands (e.g. ./my-script)
    // are allowed — that is user-intent behavior, not a vulnerability, since the
    // caller explicitly passed the command string.
    const child = spawn(cmd, args, { env: options.env, stdio: 'inherit' })

    const sigintHandler = () => {
      child.kill('SIGINT')
    }
    const sigtermHandler = () => {
      child.kill('SIGTERM')
    }

    process.on('SIGINT', sigintHandler)
    process.on('SIGTERM', sigtermHandler)

    let abortHandler: (() => void) | undefined
    if (options.signal !== undefined) {
      abortHandler = () => {
        child.kill('SIGTERM')
      }
      options.signal.addEventListener('abort', abortHandler)
    }

    function teardown() {
      process.off('SIGINT', sigintHandler)
      process.off('SIGTERM', sigtermHandler)
      if (options.signal !== undefined && abortHandler !== undefined) {
        options.signal.removeEventListener('abort', abortHandler)
      }
    }

    child.on('error', (error: Error) => {
      teardown()
      resolve(
        err(
          new PortweaveError(
            PW_ERROR_CODES.CLI_CHILD_SPAWN_FAILED,
            `failed to spawn "${cmd}": ${error.message}`,
          ),
        ),
      )
    })

    child.on('exit', (code: null | number, signal: NodeJS.Signals | null) => {
      teardown()
      resolve(ok({ exitCode: code, signal }))
    })
  })
}

/**
 * Converts a `SpawnChildResult` into a numeric exit code following POSIX
 * shell conventions:
 * - exitCode is returned as-is when not null
 * - signal termination → 128 + signal number
 * - unknown termination → 1
 */
export function resolveExitCode(result: SpawnChildResult): number {
  if (result.exitCode !== null) {
    return result.exitCode
  }
  if (result.signal !== null) {
    return 128 + signalNumber(result.signal)
  }
  // Both exitCode and signal are null: child was killed externally before the
  // exit event fired with meaningful values. Return 1 as a safe non-zero sentinel.
  return 1
}

const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGABRT: 6,
  SIGHUP: 1,
  SIGINT: 2,
  SIGKILL: 9,
  SIGQUIT: 3,
  SIGSTOP: 19,
  SIGTERM: 15,
}

function signalNumber(signal: NodeJS.Signals): number {
  return SIGNAL_NUMBERS[signal] ?? 0
}
