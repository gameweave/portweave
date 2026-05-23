import { describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { synthesizeAnonymousConfig } from '../anonymous.ts'
import { validateAndNormalizeConfig } from '../schema.ts'

describe('synthesizeAnonymousConfig', () => {
  it('produces N services named port-1..port-N', () => {
    const result = synthesizeAnonymousConfig(3)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services.map((s) => s.name)).toStrictEqual([
      'port-1',
      'port-2',
      'port-3',
    ])
  })

  it('assigns env vars PORT_1..PORT_N in source order', () => {
    const result = synthesizeAnonymousConfig(4)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services.map((s) => s.envVar)).toStrictEqual([
      'PORT_1',
      'PORT_2',
      'PORT_3',
      'PORT_4',
    ])
  })

  it('emits empty discoveryEnv and absent preferred/group per service', () => {
    const result = synthesizeAnonymousConfig(2)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    for (const service of result.value.services) {
      expect(service.discoveryEnv).toStrictEqual({})
      expect(service.preferred).toBeUndefined()
      expect(service.group).toBeUndefined()
    }
  })

  it('marks source as anonymous with no sourcePath and empty groups', () => {
    const result = synthesizeAnonymousConfig(1)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.source).toBe('anonymous')
    expect(result.value.sourcePath).toBeUndefined()
    expect(result.value.groups).toStrictEqual({})
  })

  it('accepts the upper bound of 100', () => {
    const result = synthesizeAnonymousConfig(100)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services).toHaveLength(100)
  })

  it.each([0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects out-of-range or non-integer count: %s',
    (count) => {
      const result = synthesizeAnonymousConfig(count)
      expect(result.ok).toBe(false)
      if (result.ok) {
        return
      }
      expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_INVALID)
      expect(result.error.message.length).toBeGreaterThan(0)
    },
  )

  it('produces a config that re-validates against the file-schema', () => {
    const synth = synthesizeAnonymousConfig(5)
    expect(synth.ok).toBe(true)
    if (!synth.ok) {
      return
    }
    const rebuilt: Record<string, unknown> = {}
    for (const service of synth.value.services) {
      const entry: Record<string, unknown> = { envVar: service.envVar }
      if (Object.keys(service.discoveryEnv).length > 0) {
        entry.discoveryEnv = service.discoveryEnv
      }
      if (service.group !== undefined) {
        entry.group = service.group
      }
      if (service.preferred !== undefined) {
        entry.preferred = service.preferred
      }
      rebuilt[service.name] = entry
    }
    const result = validateAndNormalizeConfig(
      { services: rebuilt },
      { source: 'anonymous' },
    )
    expect(result.ok).toBe(true)
  })
})
