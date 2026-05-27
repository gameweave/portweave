import { describe, expect, it } from 'vitest'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import { evaluateTemplate } from '../templates.ts'

describe('evaluateTemplate', () => {
  it('substitutes a single placeholder with the matching port', () => {
    const result = evaluateTemplate('http://localhost:${api}', { api: 30100 })
    expect(result).toBe('http://localhost:30100')
  })

  it('substitutes multiple placeholders in a single template', () => {
    const result = evaluateTemplate('http://localhost:${api}/from/${ws}', {
      api: 30100,
      ws: 30101,
    })
    expect(result).toBe('http://localhost:30100/from/30101')
  })

  it('passes through a template with no placeholders unchanged', () => {
    const result = evaluateTemplate('http://localhost:3000', { api: 30100 })
    expect(result).toBe('http://localhost:3000')
  })

  it('throws PW0501 when a placeholder references an unknown service', () => {
    let thrownError: unknown
    try {
      evaluateTemplate('http://localhost:${missing}', { api: 30100 })
    } catch (e) {
      thrownError = e
    }
    expect(thrownError).toBeInstanceOf(PortweaveError)
    expect((thrownError as PortweaveError).code).toBe(
      PW_ERROR_CODES.ENV_BUILD_INVALID,
    )
  })

  it('substitutes the same placeholder that appears multiple times', () => {
    const result = evaluateTemplate('${api}:${api}', { api: 30100 })
    expect(result).toBe('30100:30100')
  })

  it('handles ws-scheme URLs', () => {
    const result = evaluateTemplate('ws://localhost:${ws}', { ws: 30101 })
    expect(result).toBe('ws://localhost:30101')
  })
})
