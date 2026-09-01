import { describe, expect, it } from 'vitest'
import type { Allocation } from '../../allocator/allocate.ts'
import type { Config } from '../../config/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import { buildEnvMap } from '../build.ts'

// DESIGN.md Appendix A config (normalized form)
const appendixAConfig: Config = {
  envAuthority: 'dotenv',
  groups: {
    dynamodb: ['dynamodb', 'dynamodb-admin'],
    kinesis: ['kinesis', 'kinesis-tls'],
  },
  services: [
    {
      discoveryEnv: {
        E2E_API_ORIGIN: 'http://localhost:${api}',
        VITE_API_URL: 'http://localhost:${api}',
      },
      envVar: 'API_PORT',
      name: 'api',
      preferred: 3001,
    },
    {
      discoveryEnv: {
        VITE_WS_URL: 'ws://localhost:${ws}',
        WEBSOCKET_ENDPOINT: 'http://localhost:${ws}',
      },
      envVar: 'WS_PORT',
      name: 'ws',
      preferred: 3002,
    },
    {
      discoveryEnv: {},
      envVar: 'VITE_PORT',
      name: 'vite',
      preferred: 5173,
    },
    {
      discoveryEnv: {},
      envVar: 'DYNAMODB_PORT',
      group: 'dynamodb',
      name: 'dynamodb',
      preferred: 8000,
    },
    {
      discoveryEnv: {},
      envVar: 'DYNAMODB_ADMIN_PORT',
      group: 'dynamodb',
      name: 'dynamodb-admin',
      preferred: 8001,
    },
    {
      discoveryEnv: {},
      envVar: 'KINESIS_PORT',
      group: 'kinesis',
      name: 'kinesis',
      preferred: 4568,
    },
    {
      discoveryEnv: {},
      envVar: 'KINESIS_TLS_PORT',
      group: 'kinesis',
      name: 'kinesis-tls',
      preferred: 4567,
    },
    {
      discoveryEnv: {},
      envVar: 'SES_LOCAL_PORT',
      name: 'ses',
      preferred: 8005,
    },
  ],
  source: 'file',
}

// Appendix B allocation: api→3104, ws→3105, vite→5178, dynamodb→8104,
// dynamodb-admin→8105, kinesis→4672, kinesis-tls→4671, ses→8109
const appendixBAllocation: Allocation = {
  key: {
    gitCommonDir: '/fake/.git',
    namespace: 'feature-x-7a2b91',
    offsetOverride: null,
    worktreeRoot: '/fake/my-app-feature-x',
  },
  lastUsedAt: '2026-05-26T00:00:00.000Z',
  namespace: 'feature-x-7a2b91',
  ports: {
    api: 3104,
    dynamodb: 8104,
    'dynamodb-admin': 8105,
    kinesis: 4672,
    'kinesis-tls': 4671,
    ses: 8109,
    vite: 5178,
    ws: 3105,
  },
}

describe('buildEnvMap', () => {
  it('produces all env vars for Appendix A config + Appendix B allocation', () => {
    const result = buildEnvMap(appendixBAllocation, appendixAConfig)

    // Direct port vars
    expect(result.API_PORT).toBe('3104')
    expect(result.WS_PORT).toBe('3105')
    expect(result.VITE_PORT).toBe('5178')
    expect(result.DYNAMODB_PORT).toBe('8104')
    expect(result.DYNAMODB_ADMIN_PORT).toBe('8105')
    expect(result.KINESIS_PORT).toBe('4672')
    expect(result.KINESIS_TLS_PORT).toBe('4671')
    expect(result.SES_LOCAL_PORT).toBe('8109')

    // Discovery URL vars using allocated ports
    expect(result.VITE_API_URL).toBe('http://localhost:3104')
    expect(result.E2E_API_ORIGIN).toBe('http://localhost:3104')
    expect(result.VITE_WS_URL).toBe('ws://localhost:3105')
    expect(result.WEBSOCKET_ENDPOINT).toBe('http://localhost:3105')

    // Baseline reserved var: the namespace Portweave allocated under
    expect(result.PORTWEAVE_NAMESPACE).toBe('feature-x-7a2b91')
  })

  it('always emits PORTWEAVE_NAMESPACE for the main worktree too', () => {
    const mainAllocation: Allocation = {
      ...appendixBAllocation,
      key: { ...appendixBAllocation.key, namespace: 'main' },
      namespace: 'main',
    }
    const result = buildEnvMap(mainAllocation, appendixAConfig)
    expect(result.PORTWEAVE_NAMESPACE).toBe('main')
  })

  it('resolves ${pw:*} placeholders inside discoveryEnv', () => {
    const config: Config = {
      envAuthority: 'dotenv',
      groups: {},
      services: [
        {
          discoveryEnv: {
            OTEL_SERVICE_NAME: 'gw-${pw:namespace}',
            UPSTREAM: 'http://localhost:${api}',
          },
          envVar: 'API_PORT',
          name: 'api',
        },
      ],
      source: 'file',
    }
    const result = buildEnvMap(appendixBAllocation, config)
    expect(result.OTEL_SERVICE_NAME).toBe('gw-feature-x-7a2b91')
    expect(result.UPSTREAM).toBe('http://localhost:3104')
  })

  it('resolves the reserved ${namespace} token inside discoveryEnv', () => {
    const config: Config = {
      envAuthority: 'dotenv',
      groups: {},
      services: [
        {
          discoveryEnv: {
            API_URL: 'http://localhost:${api}/${namespace}',
            DDB_TABLE_PREFIX: 'local-${namespace}',
          },
          envVar: 'API_PORT',
          name: 'api',
        },
      ],
      source: 'file',
    }
    const result = buildEnvMap(appendixBAllocation, config)
    // appendixBAllocation.namespace === 'feature-x-7a2b91', api port 3104
    expect(result.DDB_TABLE_PREFIX).toBe('local-feature-x-7a2b91')
    expect(result.API_URL).toBe('http://localhost:3104/feature-x-7a2b91')
  })

  it('throws PW0501 when a service port is missing from the allocation', () => {
    const incompleteAllocation: Allocation = {
      ...appendixBAllocation,
      ports: { api: 3104 }, // missing ws, vite, etc.
    }

    const simpleConfig: Config = {
      envAuthority: 'dotenv',
      groups: {},
      services: [
        { discoveryEnv: {}, envVar: 'API_PORT', name: 'api' },
        { discoveryEnv: {}, envVar: 'WS_PORT', name: 'ws' },
      ],
      source: 'file',
    }

    expect(() => buildEnvMap(incompleteAllocation, simpleConfig)).toThrow(
      PortweaveError,
    )

    let thrownError: unknown
    try {
      buildEnvMap(incompleteAllocation, simpleConfig)
    } catch (e) {
      thrownError = e
    }

    expect(thrownError).toBeInstanceOf(PortweaveError)
    expect((thrownError as PortweaveError).code).toBe(
      PW_ERROR_CODES.ENV_BUILD_INVALID,
    )
  })

  it('produces an empty map for a config with no discovery env', () => {
    const singleServiceConfig: Config = {
      envAuthority: 'dotenv',
      groups: {},
      services: [{ discoveryEnv: {}, envVar: 'API_PORT', name: 'api' }],
      source: 'file',
    }
    const allocation: Allocation = {
      key: {
        gitCommonDir: '/fake/.git',
        namespace: 'main',
        offsetOverride: null,
        worktreeRoot: '/fake/project',
      },
      lastUsedAt: '2026-05-26T00:00:00.000Z',
      namespace: 'main',
      ports: { api: 30000 },
    }
    const result = buildEnvMap(allocation, singleServiceConfig)
    expect(result).toEqual({ API_PORT: '30000', PORTWEAVE_NAMESPACE: 'main' })
  })
})
