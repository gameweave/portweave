import type { Command } from 'commander'
import { allocate, type AllocationResult } from '../allocator/allocate.ts'
import { synthesizeAnonymousConfig } from '../config/anonymous.ts'
import type { Config } from '../config/index.ts'
import { loadConfig } from '../config/loader.ts'
import { type ResolvedEnv, resolveEnv } from '../env/index.ts'
import { PORTWEAVE_NAMESPACE_VAR } from '../env/metadata.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, type Result } from '../result.ts'
import { type AllocationKey, resolveAllocationKey } from '../worktree/key.ts'
import {
  buildVerboseLines,
  formatAllocationBanner,
  formatErrorLine,
} from './banner.ts'
import { skipAsNonPrimary } from './primary-only.ts'
import { resolveExitCode, spawnChild } from './spawn.ts'

export interface RunIo {
  cwd: () => string
  env: NodeJS.ProcessEnv
  stderr: NodeJS.WritableStream
  stdout: NodeJS.WritableStream
}

export interface RunOptions {
  configPath?: string
  count?: number
  primaryOnly: boolean
  verbose: boolean
}

const defaultRunIo: RunIo = {
  cwd: () => process.cwd(),
  env: process.env,
  stderr: process.stderr,
  stdout: process.stdout,
}

interface WriteErrorOptions {
  code?: string
  io: RunIo
  message: string
  stack?: string
  verbose?: boolean
}

function writeError(opts: WriteErrorOptions): void {
  opts.io.stderr.write(formatErrorLine(opts.message, opts.code) + '\n')
  if (opts.verbose === true && opts.stack !== undefined) {
    opts.io.stderr.write(opts.stack + '\n')
  }
}

function writePortweaveError(
  error: PortweaveError,
  io: RunIo,
  verbose: boolean,
): void {
  writeError({
    code: error.code,
    io,
    message: error.message,
    stack: error.stack,
    verbose,
  })
}

function validateFlags(
  childArgs: readonly string[],
  options: RunOptions,
): Result<void, PortweaveError> {
  if (options.configPath !== undefined && options.count !== undefined) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        '--config and --count are mutually exclusive',
      ),
    )
  }
  if (childArgs.length === 0) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        'no command provided after --',
      ),
    )
  }
  if (
    options.count !== undefined &&
    (!Number.isInteger(options.count) || options.count <= 0)
  ) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        `--count must be a positive integer, received ${String(options.count)}`,
      ),
    )
  }
  return { ok: true, value: undefined }
}

async function resolveConfig(
  cwd: string,
  options: RunOptions,
  io: RunIo,
): Promise<Config | null> {
  if (options.count !== undefined) {
    const result = synthesizeAnonymousConfig(options.count)
    if (!result.ok) {
      writePortweaveError(result.error, io, options.verbose)
      return null
    }
    return result.value
  }
  const result = await loadConfig(cwd, { configPath: options.configPath })
  if (!result.ok) {
    writePortweaveError(result.error, io, options.verbose)
    return null
  }
  return result.value
}

interface SpawnBannerContext {
  allocResult: AllocationResult
  childArgs: readonly string[]
  config: Config
  io: RunIo
  key: AllocationKey
  options: RunOptions
  resolvedEnv: ResolvedEnv
}

async function spawnWithBanner(ctx: SpawnBannerContext): Promise<number> {
  const { allocResult, childArgs, config, io, key, options, resolvedEnv } = ctx
  const { allocation, reused } = allocResult
  const verboseLines = options.verbose
    ? buildVerboseLines(config, key, io.env)
    : undefined
  io.stderr.write(
    formatAllocationBanner({
      allocation,
      config,
      launchingCommand: childArgs.join(' '),
      reused,
      verboseLines,
      wroteEnvFile: true,
    }) + '\n',
  )
  // io.env wins (DESIGN.md §7.2 row 9), except PORTWEAVE_NAMESPACE re-asserted below.
  const mergedEnv: NodeJS.ProcessEnv = { ...resolvedEnv.env, ...io.env }
  mergedEnv[PORTWEAVE_NAMESPACE_VAR] = resolvedEnv.env[PORTWEAVE_NAMESPACE_VAR]
  const spawnResult = await spawnChild(childArgs, { env: mergedEnv, io })
  if (!spawnResult.ok) {
    writeError({
      code: spawnResult.error.code,
      io,
      message: spawnResult.error.message,
      verbose: options.verbose,
    })
    return 127
  }
  return resolveExitCode(spawnResult.value)
}

export async function runCommand(
  childArgs: readonly string[],
  options: RunOptions,
  io: RunIo = defaultRunIo,
): Promise<number> {
  const flagResult = validateFlags(childArgs, options)
  if (!flagResult.ok) {
    writeError({
      code: flagResult.error.code,
      io,
      message: flagResult.error.message,
    })
    return 1
  }

  const keyResult = resolveAllocationKey(io.cwd())
  if (!keyResult.ok) {
    writePortweaveError(keyResult.error, io, options.verbose)
    return 1
  }
  const key = keyResult.value

  if (options.primaryOnly && skipAsNonPrimary(key, io)) {
    return 0
  }

  const config = await resolveConfig(io.cwd(), options, io)
  if (config === null) {
    return 1
  }

  const allocResult = await allocate(key, config, io.env)
  if (!allocResult.ok) {
    writePortweaveError(allocResult.error, io, options.verbose)
    return 1
  }

  const envResult = await resolveEnv(
    allocResult.value.allocation,
    config,
    key.worktreeRoot,
  )
  if (!envResult.ok) {
    writePortweaveError(envResult.error, io, options.verbose)
    return 1
  }

  return spawnWithBanner({
    allocResult: allocResult.value,
    childArgs,
    config,
    io,
    key,
    options,
    resolvedEnv: envResult.value,
  })
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Allocate ports and run a command with env vars injected')
    .argument('[childArgs...]', 'command and args to run after --')
    .allowUnknownOption(true)
    .action(async (childArgs: string[]) => {
      const opts = program.opts<{
        config?: string
        count?: string
        primaryOnly?: boolean
        verbose?: boolean
      }>()
      const count = opts.count !== undefined ? Number(opts.count) : undefined
      const exitCode = await runCommand(childArgs, {
        configPath: opts.config,
        count,
        primaryOnly: opts.primaryOnly === true,
        verbose: opts.verbose === true,
      })
      process.exitCode = exitCode
    })
}
