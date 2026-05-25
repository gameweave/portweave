import { describe, expect, it } from 'vitest'
import { orderServicesForAllocation } from '../allocate.ts'
import { makeAllocatorConfig } from './_helpers.ts'

describe('orderServicesForAllocation', () => {
  it('keeps a single ungrouped service at the front', () => {
    const config = makeAllocatorConfig([{ envVar: 'API_PORT', name: 'api' }])
    const result = orderServicesForAllocation(config)
    expect(result.map((s) => s.name)).toEqual(['api'])
  })

  it('keeps multiple ungrouped services in their original order', () => {
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
      { envVar: 'WS_PORT', name: 'ws' },
    ])
    const result = orderServicesForAllocation(config)
    expect(result.map((s) => s.name)).toEqual(['api', 'vite', 'ws'])
  })

  it('groups scattered group members contiguously', () => {
    // kinesis appears at index 0, kinesis-tls at index 2 (scattered)
    const config = makeAllocatorConfig([
      { envVar: 'KINESIS_PORT', group: 'kinesis', name: 'kinesis' },
      { envVar: 'API_PORT', name: 'api' },
      { envVar: 'KINESIS_TLS_PORT', group: 'kinesis', name: 'kinesis-tls' },
    ])
    const result = orderServicesForAllocation(config)
    const names = result.map((s) => s.name)
    // kinesis group was first-seen at index 0, so it comes first
    // api is ungrouped at index 1, so it follows
    expect(names).toEqual(['kinesis', 'kinesis-tls', 'api'])
  })

  it('preserves first-occurrence group order', () => {
    // api group first-seen at index 0; kinesis group first-seen at index 2
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', group: 'api', name: 'api' },
      { envVar: 'WS_PORT', group: 'api', name: 'ws' },
      { envVar: 'KINESIS_PORT', group: 'kinesis', name: 'kinesis' },
      { envVar: 'KINESIS_TLS_PORT', group: 'kinesis', name: 'kinesis-tls' },
    ])
    const result = orderServicesForAllocation(config)
    expect(result.map((s) => s.name)).toEqual([
      'api',
      'ws',
      'kinesis',
      'kinesis-tls',
    ])
  })

  it('interleaves ungrouped services at their original positions relative to groups', () => {
    // vite (ungrouped) at index 1; dynamodb group first-seen at index 2
    const config = makeAllocatorConfig([
      { envVar: 'API_PORT', group: 'api', name: 'api' },
      { envVar: 'VITE_PORT', name: 'vite' },
      { envVar: 'DB_PORT', group: 'dynamodb', name: 'dynamodb' },
      { envVar: 'DB_ADMIN_PORT', group: 'dynamodb', name: 'dynamodb-admin' },
    ])
    const result = orderServicesForAllocation(config)
    // api group: first-seen at 0; vite: at index 1; dynamodb group: at index 2
    expect(result.map((s) => s.name)).toEqual([
      'api',
      'vite',
      'dynamodb',
      'dynamodb-admin',
    ])
  })

  it('handles a group whose members are completely scattered', () => {
    const config = makeAllocatorConfig([
      { envVar: 'A_PORT', name: 'alpha' },
      { envVar: 'K_PORT', group: 'kinesis', name: 'kinesis' },
      { envVar: 'B_PORT', name: 'beta' },
      { envVar: 'K_TLS_PORT', group: 'kinesis', name: 'kinesis-tls' },
      { envVar: 'C_PORT', name: 'gamma' },
    ])
    const result = orderServicesForAllocation(config)
    const names = result.map((s) => s.name)
    // kinesis group first-seen at index 1
    // alpha at 0, beta at 2, gamma at 4
    expect(names).toEqual(['alpha', 'kinesis', 'kinesis-tls', 'beta', 'gamma'])
  })

  it('is idempotent — calling twice returns the same order', () => {
    const config = makeAllocatorConfig([
      { envVar: 'K_PORT', group: 'kinesis', name: 'kinesis' },
      { envVar: 'A_PORT', name: 'api' },
      { envVar: 'K_TLS_PORT', group: 'kinesis', name: 'kinesis-tls' },
    ])
    const first = orderServicesForAllocation(config).map((s) => s.name)
    const second = orderServicesForAllocation(config).map((s) => s.name)
    expect(first).toEqual(second)
  })
})
