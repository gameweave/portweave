import { describe, expect, it } from 'vitest'
import type { Allocation } from '../../allocator/allocate.ts'
import type { Config } from '../../config/index.ts'
import type { ResolvedEnv } from '../../env/index.ts'
import {
  type BannerInput,
  formatAllocationBanner,
  formatErrorLine,
} from '../banner.ts'

function makeAllocation(overrides?: Partial<Allocation>): Allocation {
  return {
    key: {
      gitCommonDir: '/repo/.git',
      namespace: 'main',
      offsetOverride: null,
      worktreeRoot: '/repo',
    },
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    namespace: 'main',
    ports: { api: 30000 },
    ...overrides,
  }
}

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    groups: {},
    services: [{ discoveryEnv: {}, envVar: 'API_PORT', name: 'api' }],
    source: 'file',
    ...overrides,
  }
}

function makeResolvedEnv(overrides?: Partial<ResolvedEnv>): ResolvedEnv {
  return {
    createdPortweaveDir: false,
    currentEnvPath: '/repo/.portweave/current.env',
    env: { API_PORT: '30000' },
    ...overrides,
  }
}

function makeInput(overrides?: Partial<BannerInput>): BannerInput {
  return {
    allocation: makeAllocation(),
    config: makeConfig(),
    launchingCommand: 'npm start',
    resolvedEnv: makeResolvedEnv(),
    reused: false,
    ...overrides,
  }
}

describe('formatAllocationBanner — verbs and structure', () => {
  it('fresh allocation uses "allocated:" verb', () => {
    const banner = formatAllocationBanner(makeInput({ reused: false }))
    expect(banner).toContain('[portweave] allocated:')
    expect(banner).not.toContain('reusing')
  })

  it('reused allocation uses "reusing existing allocation:" verb', () => {
    const banner = formatAllocationBanner(makeInput({ reused: true }))
    expect(banner).toContain('[portweave] reusing existing allocation:')
    expect(banner).not.toContain('[portweave] allocated:')
  })

  it('includes worktree/namespace header', () => {
    expect(formatAllocationBanner(makeInput())).toContain(
      '[portweave] worktree: repo (namespace: main)',
    )
  })

  it('includes service rows with env var', () => {
    const banner = formatAllocationBanner(makeInput())
    expect(banner).toContain('→ 30000')
    expect(banner).toContain('(API_PORT)')
  })

  it('includes "wrote .portweave/current.env" line', () => {
    expect(formatAllocationBanner(makeInput())).toContain(
      '[portweave] wrote .portweave/current.env',
    )
  })

  it('includes launching line when launchingCommand is set', () => {
    expect(
      formatAllocationBanner(makeInput({ launchingCommand: 'npm start' })),
    ).toContain('[portweave] launching: npm start')
  })

  it('omits launching line when launchingCommand is undefined (show-command path)', () => {
    expect(
      formatAllocationBanner(makeInput({ launchingCommand: undefined })),
    ).not.toContain('launching:')
  })

  it('exports are importable by show-command (interface + function shape)', () => {
    expect(typeof formatAllocationBanner).toBe('function')
    expect(typeof formatErrorLine).toBe('function')
    const showBanner = formatAllocationBanner(
      makeInput({ launchingCommand: undefined, reused: true }),
    )
    expect(showBanner).toContain('reusing existing allocation:')
    expect(showBanner).not.toContain('launching:')
  })
})

describe('formatAllocationBanner — padding and verbose', () => {
  it('service names are padded to longest name + 2 spaces', () => {
    const allocation = makeAllocation({
      ports: { api: 30000, 'some-long-service': 30001 },
    })
    const config = makeConfig({
      services: [
        { discoveryEnv: {}, envVar: 'API_PORT', name: 'api' },
        {
          discoveryEnv: {},
          envVar: 'SOME_LONG_SERVICE_PORT',
          name: 'some-long-service',
        },
      ],
    })
    const resolvedEnv = makeResolvedEnv({
      env: { API_PORT: '30000', SOME_LONG_SERVICE_PORT: '30001' },
    })
    const banner = formatAllocationBanner(
      makeInput({ allocation, config, resolvedEnv }),
    )
    const lines = banner.split('\n')
    const apiLine = lines.find((l) => l.includes('API_PORT'))
    const longLine = lines.find((l) => l.includes('SOME_LONG_SERVICE_PORT'))
    expect(apiLine).toBeDefined()
    expect(longLine).toBeDefined()
    if (apiLine === undefined || longLine === undefined) {
      throw new Error('Service lines not found in banner')
    }
    expect(apiLine.indexOf('→')).toBe(longLine.indexOf('→'))
  })

  it('verboseLines inserted after "wrote" and before "launching"', () => {
    const verboseLines = [
      '[portweave] config: /repo/portweave.config.json',
      '[portweave] registry: ~/.config/portweave/registry.json',
    ]
    const banner = formatAllocationBanner(makeInput({ verboseLines }))
    const lines = banner.split('\n')
    const wroteIdx = lines.findIndex((l) =>
      l.includes('wrote .portweave/current.env'),
    )
    const launchIdx = lines.findIndex((l) => l.includes('launching:'))
    const verboseIdx = lines.findIndex((l) =>
      l.includes('config: /repo/portweave.config.json'),
    )
    expect(wroteIdx).toBeGreaterThan(-1)
    expect(verboseIdx).toBeGreaterThan(wroteIdx)
    if (launchIdx > -1) {
      expect(verboseIdx).toBeLessThan(launchIdx)
    }
  })

  it('multi-service snapshot matches Appendix B shape', () => {
    const allocation = makeAllocation({
      key: {
        gitCommonDir: '/project/.git',
        namespace: 'feature-xyz',
        offsetOverride: null,
        worktreeRoot: '/project/worktrees/feature-xyz',
      },
      namespace: 'feature-xyz',
      ports: { api: 30100, db: 30101 },
    })
    const config = makeConfig({
      services: [
        { discoveryEnv: {}, envVar: 'API_PORT', name: 'api' },
        { discoveryEnv: {}, envVar: 'DB_PORT', name: 'db' },
      ],
    })
    const resolvedEnv = makeResolvedEnv({
      currentEnvPath: '/project/worktrees/feature-xyz/.portweave/current.env',
      env: { API_PORT: '30100', DB_PORT: '30101' },
    })
    const banner = formatAllocationBanner(
      makeInput({
        allocation,
        config,
        launchingCommand: 'npm run dev',
        resolvedEnv,
        reused: false,
      }),
    )
    expect(banner).toContain(
      '[portweave] worktree: feature-xyz (namespace: feature-xyz)',
    )
    expect(banner).toContain('[portweave] allocated:')
    expect(banner).toContain('(API_PORT)')
    expect(banner).toContain('(DB_PORT)')
    expect(banner).toContain('[portweave] wrote .portweave/current.env')
    expect(banner).toContain('[portweave] launching: npm run dev')
  })
})

describe('formatErrorLine', () => {
  it('formats error without code', () => {
    expect(formatErrorLine('something went wrong')).toBe(
      '[portweave] error: something went wrong',
    )
  })

  it('formats error with code', () => {
    expect(formatErrorLine('invalid flags', 'PW0601')).toBe(
      '[portweave] error: invalid flags (PW0601)',
    )
  })
})
