import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../../cli.ts'
import { runSlots, type SlotsOptions } from '../slots.ts'
import { expectExitCode, runCapture } from './_helpers.ts'

// Service declaration order decides which service takes a slot's base port, so
// the fixtures are raw JSON: an object literal would be alphabetized by
// perfectionist, and JSON is what a real portweave.config.json is anyway.
const SERVICES_JSON =
  '"services": { "web": { "envVar": "WEB_PORT" }, "api": { "envVar": "API_PORT" } }'

const SLOT_CONFIG_JSON = `{
  "pool": { "basePort": 3000, "mode": "slots", "slots": 3, "stride": 10 },
  ${SERVICES_JSON}
}`

const PRIMARY_SLOT_2_JSON = `{
  "pool": { "basePort": 3000, "mode": "slots", "primarySlot": 2, "slots": 3, "stride": 10 },
  ${SERVICES_JSON}
}`

const NO_POOL_JSON = `{ ${SERVICES_JSON} }`

const BAD_STRIDE_JSON = `{
  "pool": { "basePort": 3000, "mode": "slots", "slots": 3, "stride": 1 },
  ${SERVICES_JSON}
}`

let worktreeDir: string

beforeEach(async () => {
  worktreeDir = await mkdtemp(join(tmpdir(), 'pw-slots-wt-'))
})

afterEach(async () => {
  await rm(worktreeDir, { force: true, recursive: true })
})

async function writeConfig(json: string): Promise<void> {
  await writeFile(join(worktreeDir, 'portweave.config.json'), json)
}

function makeOptions(overrides: Partial<SlotsOptions> = {}): SlotsOptions {
  return { cwd: worktreeDir, ...overrides }
}

describe('runSlots — human output', () => {
  it('lists every slot with its per-service ports', async () => {
    await writeConfig(SLOT_CONFIG_JSON)
    const { out, result } = await runCapture((streams) =>
      runSlots(makeOptions(streams)),
    )
    expectExitCode(result, 0)

    const lines = out.value().trimEnd().split('\n')
    expect(lines).toStrictEqual([
      'slot 0 (primary)  web=3000 api=3001',
      'slot 1  web=3010 api=3011',
      'slot 2  web=3020 api=3021',
    ])
  })

  it('marks a non-zero primarySlot instead of slot 0', async () => {
    await writeConfig(PRIMARY_SLOT_2_JSON)
    const { out, result } = await runCapture((streams) =>
      runSlots(makeOptions(streams)),
    )
    expectExitCode(result, 0)
    expect(out.value()).toContain('slot 2 (primary)')
    expect(out.value()).not.toContain('slot 0 (primary)')
  })
})

describe('runSlots — templates', () => {
  it('renders one bare line per slot, ready to join into an allow-list', async () => {
    await writeConfig(SLOT_CONFIG_JSON)
    const { out, result } = await runCapture((streams) =>
      runSlots(
        makeOptions({
          ...streams,
          templates: ['http://localhost:${web}/auth/callback'],
        }),
      ),
    )
    expectExitCode(result, 0)
    expect(out.value()).toBe(
      [
        'http://localhost:3000/auth/callback',
        'http://localhost:3010/auth/callback',
        'http://localhost:3020/auth/callback',
        '',
      ].join('\n'),
    )
  })

  it('renders multiple templates per slot, in the order given', async () => {
    await writeConfig(SLOT_CONFIG_JSON)
    const { out, result } = await runCapture((streams) =>
      runSlots(
        makeOptions({
          ...streams,
          templates: ['http://localhost:${web}', 'http://localhost:${api}'],
        }),
      ),
    )
    expectExitCode(result, 0)
    expect(out.value().trimEnd().split('\n')).toStrictEqual([
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3010',
      'http://localhost:3011',
      'http://localhost:3020',
      'http://localhost:3021',
    ])
  })

  it('resolves the reserved ${namespace} token', async () => {
    await writeConfig(SLOT_CONFIG_JSON)
    const { out, result } = await runCapture((streams) =>
      runSlots(makeOptions({ ...streams, templates: ['pw-${namespace}'] })),
    )
    expectExitCode(result, 0)
    // A bare temp dir is its own main worktree.
    expect(out.value()).toContain('pw-main')
  })
})

describe('runSlots — JSON output', () => {
  it('reports the pool geometry alongside every slot', async () => {
    await writeConfig(SLOT_CONFIG_JSON)
    const { out, result } = await runCapture((streams) =>
      runSlots(
        makeOptions({
          ...streams,
          json: true,
          templates: ['http://localhost:${web}'],
        }),
      ),
    )
    expectExitCode(result, 0)

    const parsed = JSON.parse(out.value()) as {
      basePort: number
      primarySlot: number
      slots: {
        ports: Record<string, number>
        rendered: Record<string, string>
        slot: number
      }[]
      stride: number
    }
    expect(parsed.basePort).toBe(3000)
    expect(parsed.stride).toBe(10)
    expect(parsed.primarySlot).toBe(0)
    expect(parsed.slots).toHaveLength(3)
    expect(parsed.slots[1]).toStrictEqual({
      ports: { api: 3011, web: 3010 },
      rendered: { 'http://localhost:${web}': 'http://localhost:3010' },
      slot: 1,
    })
  })
})

describe('runSlots — failure modes', () => {
  it('exits 1 and explains how to opt in when the pool block is absent', async () => {
    await writeConfig(NO_POOL_JSON)
    const { result, serr } = await runCapture((streams) =>
      runSlots(makeOptions(streams)),
    )
    expectExitCode(result, 1)
    expect(serr.value()).toContain('does not use slot mode')
    expect(serr.value()).toContain('"mode": "slots"')
  })

  it('exits 1 when there is no config at all', async () => {
    const { result, serr } = await runCapture((streams) =>
      runSlots(makeOptions(streams)),
    )
    expectExitCode(result, 1)
    expect(serr.value()).toContain('portweave.config.json')
  })

  it('exits 1 when the config itself is invalid', async () => {
    await writeConfig(BAD_STRIDE_JSON)
    const { result, serr } = await runCapture((streams) =>
      runSlots(makeOptions(streams)),
    )
    expectExitCode(result, 1)
    expect(serr.value()).toContain('pool.stride')
  })

  it('writes nothing to .portweave — enumeration never allocates', async () => {
    await writeConfig(SLOT_CONFIG_JSON)
    await runCapture((streams) => runSlots(makeOptions(streams)))
    await expect(
      rm(join(worktreeDir, '.portweave'), { recursive: true }),
    ).rejects.toThrow()
  })
})

describe('registerSlotsCommand', () => {
  it('is wired onto the Commander root', () => {
    expect(buildCli().commands.map((c) => c.name())).toContain('slots')
  })

  it('declares a repeatable --template and a --json flag', () => {
    const slots = buildCli().commands.find((c) => c.name() === 'slots')
    const flags = (slots?.options ?? []).map((o) => o.long)
    expect(flags).toContain('--template')
    expect(flags).toContain('--json')
  })

  it('accumulates repeated --template values', () => {
    const program = buildCli()
    const slots = program.commands.find((c) => c.name() === 'slots')
    const parsed = slots?.parseOptions([
      '--template',
      'a-${web}',
      '--template',
      'b-${web}',
    ])
    expect(parsed?.unknown).toStrictEqual([])
    expect(slots?.opts<{ template: string[] }>().template).toStrictEqual([
      'a-${web}',
      'b-${web}',
    ])
  })
})
