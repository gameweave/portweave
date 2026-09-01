import type { Command } from 'commander'
import {
  buildPortsMap,
  orderServicesForAllocation,
} from '../allocator/allocate.ts'
import { slotBasePort } from '../allocator/pool.ts'
import {
  type Config,
  CONFIG_FILENAME,
  discoverConfig,
  type PoolSpec,
} from '../config/index.ts'
import { evaluateTemplate, metadataFromKey } from '../env/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { type AllocationKey, resolveAllocationKey } from '../worktree/key.ts'
import { writeOut } from './banner.ts'

export interface SlotsOptions {
  configPath?: string
  cwd?: string
  json?: boolean
  stderr?: NodeJS.WritableStream
  stdout?: NodeJS.WritableStream
  templates?: readonly string[]
}

export interface SlotsOutcome {
  readonly exitCode: number
}

interface Prepared {
  readonly config: Config
  readonly key: AllocationKey
  readonly pool: PoolSpec
}

interface SlotView {
  readonly ports: Record<string, number>
  readonly rendered: Record<string, string>
  readonly slot: number
}

const NOT_SLOT_MODE_MSG =
  'this project does not use slot mode — add "pool": { "mode": "slots", "basePort": …, "stride": …, "slots": … } to portweave.config.json to get a fixed, enumerable port set'

async function prepare(
  options: SlotsOptions,
): Promise<Result<Prepared, PortweaveError>> {
  const keyResult = resolveAllocationKey(options.cwd ?? process.cwd())
  if (!keyResult.ok) {
    return keyResult
  }
  const key = keyResult.value

  const cwd = options.cwd ?? process.cwd()
  const configResult = await discoverConfig(cwd, options.configPath)
  if (!configResult.ok) {
    return configResult
  }
  if (configResult.value === null) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CONFIG_MISSING,
        `no ${CONFIG_FILENAME} found by walking up from ${cwd}`,
      ),
    )
  }
  const { config } = configResult.value

  if (config.pool === undefined) {
    return err(
      new PortweaveError(PW_ERROR_CODES.CONFIG_INVALID, NOT_SLOT_MODE_MSG),
    )
  }
  return ok({ config, key, pool: config.pool })
}

function buildSlotViews(
  prepared: Prepared,
  templates: readonly string[],
): SlotView[] {
  const { config, key, pool } = prepared
  const metadata = metadataFromKey(key, key.namespace)
  const orderedServices = orderServicesForAllocation(config)
  const views: SlotView[] = []
  for (let slot = 0; slot < pool.slots; slot += 1) {
    const ports = buildPortsMap(orderedServices, slotBasePort(pool, slot))
    const rendered: Record<string, string> = {}
    for (const template of templates) {
      rendered[template] = evaluateTemplate(template, ports, metadata)
    }
    views.push({ ports, rendered, slot })
  }
  return views
}

function formatHuman(views: readonly SlotView[], primarySlot: number): string {
  const lines: string[] = []
  for (const view of views) {
    const marker = view.slot === primarySlot ? ' (primary)' : ''
    const pairs = Object.entries(view.ports)
      .map(([name, port]) => `${name}=${String(port)}`)
      .join(' ')
    lines.push(`slot ${String(view.slot)}${marker}  ${pairs}`)
    for (const value of Object.values(view.rendered)) {
      lines.push(`  ${value}`)
    }
  }
  return lines.join('\n') + '\n'
}

// Templates-only output is deliberately bare: one value per line and nothing
// else, so a shell can turn it straight into the comma-separated allow-list an
// OAuth provider's CLI expects (`portweave slots --template … | paste -sd,`).
function formatTemplates(views: readonly SlotView[]): string {
  const lines = views.flatMap((view) => Object.values(view.rendered))
  return lines.join('\n') + '\n'
}

function formatJson(views: readonly SlotView[], pool: PoolSpec): string {
  return (
    JSON.stringify(
      {
        basePort: pool.basePort,
        primarySlot: pool.primarySlot,
        slots: views.map((view) => ({
          ports: view.ports,
          rendered: view.rendered,
          slot: view.slot,
        })),
        stride: pool.stride,
      },
      null,
      2,
    ) + '\n'
  )
}

function render(
  views: readonly SlotView[],
  pool: PoolSpec,
  options: SlotsOptions,
): string {
  if (options.json === true) {
    return formatJson(views, pool)
  }
  if ((options.templates ?? []).length > 0) {
    return formatTemplates(views)
  }
  return formatHuman(views, pool.primarySlot)
}

export async function runSlots(
  options: SlotsOptions = {},
): Promise<Result<SlotsOutcome, PortweaveError>> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  const prepared = await prepare(options)
  if (!prepared.ok) {
    await writeOut(stderr, `[portweave] ${prepared.error.message}\n`)
    return ok({ exitCode: 1 })
  }

  let views: SlotView[]
  try {
    views = buildSlotViews(prepared.value, options.templates ?? [])
  } catch (caught: unknown) {
    if (!(caught instanceof PortweaveError)) {
      throw caught
    }
    await writeOut(stderr, `[portweave] ${caught.message}\n`)
    return ok({ exitCode: 1 })
  }

  await writeOut(stdout, render(views, prepared.value.pool, options))
  return ok({ exitCode: 0 })
}

function collectTemplate(value: string, previous: string[]): string[] {
  return [...previous, value]
}

export function registerSlotsCommand(program: Command): void {
  program
    .command('slots')
    .description(
      'List every port block this project can allocate (slot mode only)',
    )
    .option(
      '--template <tpl>',
      'render a ${service} template once per slot; repeatable',
      collectTemplate,
      [] as string[],
    )
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean; template?: string[] }) => {
      const globals = program.opts<{ config?: string }>()
      const result = await runSlots({
        ...(globals.config === undefined ? {} : { configPath: globals.config }),
        json: opts.json === true,
        templates: opts.template ?? [],
      })
      if (!result.ok) {
        process.stderr.write(`[portweave] ${result.error.message}\n`)
        process.exit(1)
      }
      process.exit(result.value.exitCode)
    })
}
