import type { Command } from 'commander'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { ok, type Result } from '../result.ts'
import { startPanelServer } from '../panel/server.ts'
import { formatErrorLine, writeOut } from './banner.ts'

const DEFAULT_PANEL_PORT = 7733 as const

export interface PanelOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  port?: number
  /** Test hook: when this fires, the server shuts down and runPanel resolves. */
  signal?: AbortSignal
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
}

export interface PanelOutcome {
  readonly exitCode: number
}

const MAX_PORT = 65535

function validatePort(port: number): Result<void, PortweaveError> {
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    return {
      error: new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        `--port must be an integer between 0 and ${String(MAX_PORT)}, received ${String(port)}`,
      ),
      ok: false,
    }
  }
  return { ok: true, value: undefined }
}

export async function runPanel(
  options: PanelOptions,
): Promise<Result<PanelOutcome, PortweaveError>> {
  const env = options.env ?? process.env
  const port = options.port ?? DEFAULT_PANEL_PORT
  const stderr = options.stderr ?? process.stderr

  const portResult = validatePort(port)
  if (!portResult.ok) {
    await writeOut(
      stderr,
      formatErrorLine(portResult.error.message, portResult.error.code) + '\n',
    )
    return ok({ exitCode: 1 })
  }

  const serverResult = await startPanelServer({
    env,
    port,
    signal: options.signal,
  })
  if (!serverResult.ok) {
    await writeOut(
      stderr,
      formatErrorLine(serverResult.error.message, serverResult.error.code) +
        '\n',
    )
    return ok({ exitCode: 1 })
  }

  const server = serverResult.value
  await writeOut(
    stderr,
    `[portweave] panel: http://127.0.0.1:${String(server.port)}/\n`,
  )
  await writeOut(stderr, '[portweave] press Ctrl-C to stop\n')

  await server.closed
  return ok({ exitCode: 0 })
}

export function registerPanelCommand(program: Command): void {
  program
    .command('panel')
    .description(
      'Start a read-only web dashboard of all machine-wide allocations',
    )
    .option('--port <n>', 'port to bind the panel server (default 7733)')
    .action(async (opts: { port?: string }) => {
      const port = opts.port !== undefined ? Number(opts.port) : undefined
      const result = await runPanel({ port })
      if (!result.ok) {
        process.stderr.write(`[portweave] ${result.error.message}\n`)
        process.exit(1)
      }
      process.exit(result.value.exitCode)
    })
}
