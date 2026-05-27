import { describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { validateAndNormalizeConfig } from '../schema.ts'

const SAMPLE_APPENDIX_A = {
  $schema:
    'https://raw.githubusercontent.com/gameweave/portweave/main/schema/v1.json',
  services: {
    api: {
      discoveryEnv: {
        E2E_API_ORIGIN: 'http://localhost:${api}',
        VITE_API_URL: 'http://localhost:${api}',
      },
      envVar: 'API_PORT',
      preferred: 3001,
    },
    dynamodb: {
      envVar: 'DYNAMODB_PORT',
      group: 'dynamodb',
      preferred: 8000,
    },
    'dynamodb-admin': {
      envVar: 'DYNAMODB_ADMIN_PORT',
      group: 'dynamodb',
      preferred: 8001,
    },
    kinesis: {
      envVar: 'KINESIS_PORT',
      group: 'kinesis',
      preferred: 4568,
    },
    'kinesis-tls': {
      envVar: 'KINESIS_TLS_PORT',
      group: 'kinesis',
      preferred: 4567,
    },
    ses: {
      envVar: 'SES_LOCAL_PORT',
      preferred: 8005,
    },
    vite: {
      envVar: 'VITE_PORT',
      preferred: 5173,
    },
    ws: {
      discoveryEnv: {
        VITE_WS_URL: 'ws://localhost:${ws}',
        WEBSOCKET_ENDPOINT: 'http://localhost:${ws}',
      },
      envVar: 'WS_PORT',
      preferred: 3002,
    },
  },
}

describe('validateAndNormalizeConfig — happy path', () => {
  it('accepts DESIGN.md Appendix A and lifts the eight service names', () => {
    const result = validateAndNormalizeConfig(SAMPLE_APPENDIX_A, {
      source: 'file',
      sourcePath: '/tmp/portweave.config.json',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const names = result.value.services.map((s) => s.name)
    expect(names).toHaveLength(8)
    expect(new Set(names)).toEqual(
      new Set([
        'api',
        'dynamodb',
        'dynamodb-admin',
        'kinesis',
        'kinesis-tls',
        'ses',
        'vite',
        'ws',
      ]),
    )
    // kinesis pair share a group; dynamodb pair share a group
    expect(result.value.groups).toStrictEqual({
      dynamodb: ['dynamodb', 'dynamodb-admin'],
      kinesis: ['kinesis', 'kinesis-tls'],
    })
    // api and ws have discoveryEnv populated
    const api = result.value.services.find((s) => s.name === 'api')
    const ws = result.value.services.find((s) => s.name === 'ws')
    expect(Object.keys(api?.discoveryEnv ?? {})).not.toHaveLength(0)
    expect(Object.keys(ws?.discoveryEnv ?? {})).not.toHaveLength(0)
    // envVar values are correct (spot-check api)
    expect(api?.envVar).toBe('API_PORT')
  })

  it('derives the groups inverted index in source order', () => {
    const result = validateAndNormalizeConfig(
      {
        services: {
          a: { envVar: 'A_PORT', group: 'shared' },
          b: { envVar: 'B_PORT' },
          c: { envVar: 'C_PORT', group: 'shared' },
        },
      },
      { source: 'anonymous' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.groups).toStrictEqual({ shared: ['a', 'c'] })
  })

  it('defaults absent discoveryEnv to {} (never undefined)', () => {
    const result = validateAndNormalizeConfig(
      { services: { vite: { envVar: 'VITE_PORT' } } },
      { source: 'file', sourcePath: '/x' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services[0]?.discoveryEnv).toStrictEqual({})
  })

  it('preserves discoveryEnv templates verbatim (no resolution)', () => {
    const raw = 'http://localhost:${api}/v1?cb=${ws}'
    const result = validateAndNormalizeConfig(
      {
        services: {
          api: {
            discoveryEnv: { TARGET: raw },
            envVar: 'API_PORT',
          },
          ws: { envVar: 'WS_PORT' },
        },
      },
      { source: 'file', sourcePath: '/x' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services[0]?.discoveryEnv.TARGET).toBe(raw)
  })

  it('attaches source and sourcePath to the normalized config', () => {
    const result = validateAndNormalizeConfig(
      { services: { api: { envVar: 'API_PORT' } } },
      { source: 'file', sourcePath: '/abs/portweave.config.json' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.source).toBe('file')
    expect(result.value.sourcePath).toBe('/abs/portweave.config.json')
  })
})

function expectInvalid(input: unknown, fieldHint: string): { message: string } {
  const result = validateAndNormalizeConfig(input, { source: 'file' })
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error('expected failure')
  }
  expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_INVALID)
  expect(result.error.message).toContain(fieldHint)
  return { message: result.error.message }
}

describe('validateAndNormalizeConfig — shape failures', () => {
  it('rejects unknown top-level keys (other than $schema)', () => {
    expectInvalid(
      {
        bogus: true,
        services: { api: { envVar: 'API_PORT' } },
      },
      'bogus',
    )
  })

  it('rejects unknown keys inside a service entry', () => {
    expectInvalid(
      {
        services: { api: { envVar: 'API_PORT', sidecar: 1 } },
      },
      'sidecar',
    )
  })

  it('rejects envVar not matching SCREAMING_SNAKE_CASE', () => {
    expectInvalid({ services: { api: { envVar: 'api_port' } } }, 'envVar')
  })

  it('rejects service-name keys not matching kebab-case', () => {
    expectInvalid({ services: { Api: { envVar: 'API_PORT' } } }, 'Api')
  })

  it('rejects an empty services map', () => {
    expectInvalid({ services: {} }, 'services')
  })

  it('rejects preferred below 1', () => {
    expectInvalid(
      { services: { api: { envVar: 'API_PORT', preferred: 0 } } },
      'preferred',
    )
  })

  it('rejects preferred above 65535', () => {
    expectInvalid(
      { services: { api: { envVar: 'API_PORT', preferred: 70000 } } },
      'preferred',
    )
  })

  it('rejects non-integer preferred', () => {
    expectInvalid(
      { services: { api: { envVar: 'API_PORT', preferred: 1.5 } } },
      'preferred',
    )
  })

  it('rejects an empty group string', () => {
    expectInvalid(
      { services: { api: { envVar: 'API_PORT', group: '' } } },
      'group',
    )
  })

  it('rejects discoveryEnv keys not matching SCREAMING_SNAKE_CASE', () => {
    expectInvalid(
      {
        services: {
          api: {
            discoveryEnv: { 'lowercase-key': 'http://${api}' },
            envVar: 'API_PORT',
          },
        },
      },
      'discoveryEnv',
    )
  })

  it('accepts $schema as a top-level escape hatch', () => {
    const result = validateAndNormalizeConfig(
      {
        $schema:
          'https://raw.githubusercontent.com/gameweave/portweave/main/schema/v1.json',
        services: { api: { envVar: 'API_PORT' } },
      },
      { source: 'file' },
    )
    expect(result.ok).toBe(true)
  })
})

describe('validateAndNormalizeConfig — cross-field refinements', () => {
  it('rejects discoveryEnv templates referencing an undeclared service', () => {
    const result = validateAndNormalizeConfig(
      {
        services: {
          api: {
            discoveryEnv: { URL: 'http://${nope}/' },
            envVar: 'API_PORT',
          },
        },
      },
      { source: 'file' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.message).toContain('nope')
  })

  it('rejects duplicate envVar across two services', () => {
    const result = validateAndNormalizeConfig(
      {
        services: {
          a: { envVar: 'SAME_PORT' },
          b: { envVar: 'SAME_PORT' },
        },
      },
      { source: 'file' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.message).toContain('SAME_PORT')
  })

  it('rejects duplicate identifier across envVar and discoveryEnv key', () => {
    const result = validateAndNormalizeConfig(
      {
        services: {
          a: {
            discoveryEnv: { B_PORT: 'http://${a}' },
            envVar: 'A_PORT',
          },
          b: { envVar: 'B_PORT' },
        },
      },
      { source: 'file' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.message).toContain('B_PORT')
  })
})
