import { basename } from 'node:path'
import type { Allocation } from '../allocator/allocate.ts'
import type { Config } from '../config/index.ts'

export interface BannerInput {
  allocation: Allocation
  config: Config
  launchingCommand?: string
  reused: boolean
  verboseLines?: readonly string[]
  wroteEnvFile?: boolean
}

const PREFIX = '[portweave]'

function worktreeName(worktreeRoot: string): string {
  return basename(worktreeRoot)
}

/**
 * Returns a multi-line banner string. The caller writes it once to stderr
 * with a trailing newline appended.
 *
 * Pure — no I/O, no global state. All tests are snapshot-friendly fixtures.
 */
export function formatAllocationBanner(input: BannerInput): string {
  const {
    allocation,
    config,
    launchingCommand,
    reused,
    verboseLines,
    wroteEnvFile,
  } = input
  const { key, namespace, ports } = allocation

  const lines: string[] = []

  // Worktree header
  lines.push(
    `${PREFIX} worktree: ${worktreeName(key.worktreeRoot)} (namespace: ${namespace})`,
  )

  // Verb line
  const verb = reused ? 'reusing existing allocation:' : 'allocated:'
  lines.push(`${PREFIX} ${verb}`)

  // Service rows: left-pad name to longest service name + 2 spaces
  const serviceNames = config.services.map((s) => s.name)
  const maxNameLen = Math.max(...serviceNames.map((n) => n.length))
  const padWidth = maxNameLen + 2

  for (const service of config.services) {
    if (!(service.name in ports)) {
      continue
    }
    const port = ports[service.name]
    const paddedName = service.name.padEnd(padWidth)
    lines.push(`  ${paddedName}→ ${String(port)}     (${service.envVar})`)
  }

  // Wrote line — only when run-command actually wrote the env file; show
  // omits this since it's a read-only introspection command.
  if (wroteEnvFile === true) {
    lines.push(`${PREFIX} wrote .portweave/current.env`)
  }

  // Optional verbose lines (already prefixed with [portweave])
  if (verboseLines !== undefined) {
    for (const vl of verboseLines) {
      lines.push(vl)
    }
  }

  // Launching line (omitted by show-command)
  if (launchingCommand !== undefined) {
    lines.push(`${PREFIX} launching: ${launchingCommand}`)
  }

  return lines.join('\n')
}

/**
 * Returns a formatted error line for use in all error paths.
 *
 * `[portweave] error: <message> (<code>)` or
 * `[portweave] error: <message>`
 */
export function formatErrorLine(message: string, code?: string): string {
  return code !== undefined
    ? `${PREFIX} error: ${message} (${code})`
    : `${PREFIX} error: ${message}`
}

/**
 * Promise-wrapped stream write so CLI commands can `await` each line and
 * propagate backpressure/errors. Shared by the `show` and `panel` commands.
 */
export function writeOut(
  stream: NodeJS.WritableStream,
  text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (writeErr) => {
      if (writeErr) {
        reject(writeErr)
      } else {
        resolve()
      }
    })
  })
}
