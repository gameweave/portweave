import { describe, expect, it } from 'vitest'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import { evaluateTemplate } from '../templates.ts'

const NO_META: Record<string, string> = {}
const META = {
  gitCommonDir: '/repo/.git',
  namespace: 'feature-x-7a2b91',
  worktreeRoot: '/repo/wt/feature-x',
}

describe('evaluateTemplate', () => {
  it('substitutes a single placeholder with the matching port', () => {
    const result = evaluateTemplate(
      'http://localhost:${api}',
      { api: 30100 },
      NO_META,
    )
    expect(result).toBe('http://localhost:30100')
  })

  it('substitutes multiple placeholders in a single template', () => {
    const result = evaluateTemplate(
      'http://localhost:${api}/from/${ws}',
      { api: 30100, ws: 30101 },
      NO_META,
    )
    expect(result).toBe('http://localhost:30100/from/30101')
  })

  it('passes through a template with no placeholders unchanged', () => {
    const result = evaluateTemplate(
      'http://localhost:3000',
      { api: 30100 },
      NO_META,
    )
    expect(result).toBe('http://localhost:3000')
  })

  it('throws PW0501 when a placeholder references an unknown service', () => {
    let thrownError: unknown
    try {
      evaluateTemplate('http://localhost:${missing}', { api: 30100 }, NO_META)
    } catch (e) {
      thrownError = e
    }
    expect(thrownError).toBeInstanceOf(PortweaveError)
    expect((thrownError as PortweaveError).code).toBe(
      PW_ERROR_CODES.ENV_BUILD_INVALID,
    )
  })

  it('substitutes the same placeholder that appears multiple times', () => {
    const result = evaluateTemplate('${api}:${api}', { api: 30100 }, NO_META)
    expect(result).toBe('30100:30100')
  })

  it('handles ws-scheme URLs', () => {
    const result = evaluateTemplate(
      'ws://localhost:${ws}',
      { ws: 30101 },
      NO_META,
    )
    expect(result).toBe('ws://localhost:30101')
  })
})

describe('evaluateTemplate — ${pw:*} metadata placeholders', () => {
  it('resolves ${pw:namespace} from metadata', () => {
    expect(evaluateTemplate('${pw:namespace}', {}, META)).toBe(
      'feature-x-7a2b91',
    )
  })

  it('resolves ${pw:worktreeRoot} from metadata', () => {
    expect(evaluateTemplate('${pw:worktreeRoot}', {}, META)).toBe(
      '/repo/wt/feature-x',
    )
  })

  it('resolves ${pw:gitCommonDir} to empty string when blank (non-git)', () => {
    expect(
      evaluateTemplate('${pw:gitCommonDir}', {}, { ...META, gitCommonDir: '' }),
    ).toBe('')
  })

  it('mixes ${pw:*} metadata and ${service} ports in one template', () => {
    const result = evaluateTemplate(
      'gw-${pw:namespace}:${api}',
      { api: 30100 },
      META,
    )
    expect(result).toBe('gw-feature-x-7a2b91:30100')
  })

  it('throws PW0501 for an unknown metadata field', () => {
    let thrownError: unknown
    try {
      evaluateTemplate('${pw:bogus}', {}, META)
    } catch (e) {
      thrownError = e
    }
    expect(thrownError).toBeInstanceOf(PortweaveError)
    expect((thrownError as PortweaveError).code).toBe(
      PW_ERROR_CODES.ENV_BUILD_INVALID,
    )
  })
})
