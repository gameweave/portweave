import type { Command } from 'commander'
import type { Config } from '../config/index.ts'
import type { PortweaveError } from '../errors.ts'
import type { RegistryEntry } from '../registry/types.ts'
import type { AllocationKey } from '../worktree/key.ts'
import { buildEnvMap } from '../env/index.ts'
import { ok, type Result } from '../result.ts'
import { withRegistry } from '../registry/storage.ts'
import { loadConfig } from '../config/index.ts'
import { resolveAllocationKey } from '../worktree/key.ts'
import { formatAllocationBanner } from './banner.ts'

export interface ShowOptions {
  cwd?: string
  /**
   * Test-injection override for process.env. Scoped XDG_CONFIG_HOME and
   * other env vars flow through to `withRegistry`. Defaults to `process.env`
   * in production. See `src/cli/__tests__/show.test.ts` for usage.
   */
  env?: NodeJS.ProcessEnv
  json?: boolean
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
}

export interface ShowOutcome {
  readonly exitCode: number
}

const NO_ALLOCATION_JSON = '{"error":"no-allocation"}\n'
const NO_ALLOCATION_MSG =
  '[portweave] no allocation for this worktree — run "portweave run" first\n'

// Checks equality by the three key fields withRegistry uses internally.
function keysEqual(a: AllocationKey, b: AllocationKey): boolean {
  return (
    a.gitCommonDir === b.gitCommonDir &&
    a.namespace === b.namespace &&
    a.worktreeRoot === b.worktreeRoot
  )
}

function writeOut(stream: NodeJS.WritableStream, text: string): Promise<void> {
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

function buildJsonPayload(
  entry: RegistryEntry,
  envMap: Record<string, string>,
): string {
  // Top-level keys alphabetically sorted per spec.
  const payload = {
    env: sortedObject(envMap),
    namespace: entry.namespace,
    ports: sortedObject(entry.ports),
    worktreeRoot: entry.key.worktreeRoot,
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

// T is constrained to the JSON-leaf types we actually use (string for env,
// number for ports). The constraint documents valid usage and lets the
// type narrowing through index access stay sound under future strictness.
function sortedObject<T extends number | string>(
  obj: Record<string, T>,
): Record<string, T> {
  const sorted: Record<string, T> = {}
  for (const key of Object.keys(obj).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    sorted[key] = obj[key] as T
  }
  return sorted
}

function lookupEntry(
  key: AllocationKey,
  processEnv: NodeJS.ProcessEnv,
): Promise<Result<null | RegistryEntry, PortweaveError>> {
  return withRegistry((handle) => {
    const found = handle.entries.find((e) => keysEqual(e.key, key))
    if (found === undefined) {
      return null
    }
    handle.touch(key)
    // Return the post-touch entry
    const touched = handle.entries.find((e) => keysEqual(e.key, key))
    return touched ?? found
  }, processEnv)
}

interface EmitOutputArgs {
  config: Config
  entry: RegistryEntry
  json: boolean
  stderr: NodeJS.WritableStream
  stdout: NodeJS.WritableStream
}

async function emitOutput(args: EmitOutputArgs): Promise<0 | 1> {
  const { config, entry, json, stderr, stdout } = args
  if (!json) {
    const banner = formatAllocationBanner({
      allocation: entry,
      config,
      reused: true,
    })
    await writeOut(stdout, banner)
    return 0
  }
  let envMap: Record<string, string>
  try {
    envMap = buildEnvMap(entry, config)
  } catch (caught: unknown) {
    const msg = caught instanceof Error ? caught.message : String(caught)
    await writeOut(stderr, `[portweave] ${msg}\n`)
    return 1
  }
  await writeOut(stdout, buildJsonPayload(entry, envMap))
  return 0
}

async function resolveInputs(
  cwd: string,
): Promise<Result<{ config: Config; key: AllocationKey }, PortweaveError>> {
  const keyResult = resolveAllocationKey(cwd)
  if (!keyResult.ok) {
    return keyResult
  }
  const configResult = await loadConfig(keyResult.value.worktreeRoot)
  if (!configResult.ok) {
    return configResult
  }
  return ok({ config: configResult.value, key: keyResult.value })
}

export async function runShow(
  options: ShowOptions,
): Promise<Result<ShowOutcome, PortweaveError>> {
  const cwd = options.cwd ?? process.cwd()
  const processEnv = options.env ?? process.env
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const json = options.json === true

  const inputsResult = await resolveInputs(cwd)
  if (!inputsResult.ok) {
    await writeOut(stderr, `[portweave] ${inputsResult.error.message}\n`)
    return ok({ exitCode: 1 })
  }

  const { config, key } = inputsResult.value
  const registryResult = await lookupEntry(key, processEnv)
  if (!registryResult.ok) {
    await writeOut(stderr, `[portweave] ${registryResult.error.message}\n`)
    return ok({ exitCode: 1 })
  }

  if (registryResult.value === null) {
    await writeOut(stdout, json ? NO_ALLOCATION_JSON : '')
    if (!json) {
      await writeOut(stderr, NO_ALLOCATION_MSG)
    }
    return ok({ exitCode: 1 })
  }

  const exitCode = await emitOutput({
    config,
    entry: registryResult.value,
    json,
    stderr,
    stdout,
  })
  return ok({ exitCode })
}

export function registerShowCommand(program: Command): void {
  program
    .command('show')
    .description('Print the port allocation for the current worktree')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const result = await runShow({ json: opts.json })
      if (!result.ok) {
        process.stderr.write(`[portweave] ${result.error.message}\n`)
        process.exit(1)
      }
      process.exit(result.value.exitCode)
    })
}
