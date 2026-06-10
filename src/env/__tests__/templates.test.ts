import { describe, expect, it } from 'vitest'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import { evaluateTemplate, referencedServiceNames } from '../templates.ts'

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

describe('evaluateTemplate — reserved ${namespace} token', () => {
  it('resolves ${namespace} to the worktree namespace', () => {
    expect(evaluateTemplate('${namespace}', {}, META)).toBe('feature-x-7a2b91')
  })

  it('resolves "local-${namespace}" (DB-prefix style)', () => {
    expect(evaluateTemplate('local-${namespace}', {}, META)).toBe(
      'local-feature-x-7a2b91',
    )
  })

  it('mixes ${namespace} with a ${service} port ref in one template', () => {
    const result = evaluateTemplate(
      'http://localhost:${api}/${namespace}',
      { api: 30100 },
      META,
    )
    expect(result).toBe('http://localhost:30100/feature-x-7a2b91')
  })

  it('is reserved: ${namespace} wins over a service literally named "namespace"', () => {
    // A service named "namespace" would put a port under ports.namespace, but the
    // reserved token must still resolve to the worktree namespace string, not 30100.
    const result = evaluateTemplate('${namespace}', { namespace: 30100 }, META)
    expect(result).toBe('feature-x-7a2b91')
    expect(result).not.toBe('30100')
  })

  it('equals ${pw:namespace} for the same metadata (it is an alias)', () => {
    expect(evaluateTemplate('${namespace}', {}, META)).toBe(
      evaluateTemplate('${pw:namespace}', {}, META),
    )
  })

  it('reserves only "namespace": a bare ${worktreeRoot} is still an unknown service', () => {
    // Other metadata fields keep requiring the ${pw:*} prefix — the bare form is
    // a service-port ref, so ${worktreeRoot} with no such service throws PW0501.
    let thrownError: unknown
    try {
      evaluateTemplate('${worktreeRoot}', {}, META)
    } catch (e) {
      thrownError = e
    }
    expect(thrownError).toBeInstanceOf(PortweaveError)
    expect((thrownError as PortweaveError).code).toBe(
      PW_ERROR_CODES.ENV_BUILD_INVALID,
    )
  })
})

describe('referencedServiceNames', () => {
  // Includes a service literally named "namespace" to prove the reservation.
  const SERVICES: ReadonlySet<string> = new Set(['api', 'namespace', 'ws'])

  it('returns the single service a template references', () => {
    expect(referencedServiceNames('http://localhost:${api}', SERVICES)).toEqual(
      ['api'],
    )
  })

  it('dedupes a service referenced multiple times', () => {
    expect(referencedServiceNames('${api}:${api}', SERVICES)).toEqual(['api'])
  })

  it('returns multiple distinct services in appearance order', () => {
    expect(
      referencedServiceNames('http://localhost:${ws}/from/${api}', SERVICES),
    ).toEqual(['ws', 'api'])
  })

  it('returns empty for a literal template with no placeholders', () => {
    expect(
      referencedServiceNames('https://docs.example.com', SERVICES),
    ).toEqual([])
  })

  it('ignores ${pw:*} metadata placeholders', () => {
    expect(referencedServiceNames('gw-${pw:namespace}', SERVICES)).toEqual([])
  })

  it('ignores the reserved ${namespace} token even when a service is named "namespace"', () => {
    expect(referencedServiceNames('local-${namespace}', SERVICES)).toEqual([])
  })

  it('ignores placeholders matching no declared service (never throws)', () => {
    expect(
      referencedServiceNames('http://localhost:${missing}', SERVICES),
    ).toEqual([])
  })

  it('counts only service refs in a mixed template', () => {
    expect(
      referencedServiceNames('http://localhost:${api}/${namespace}', SERVICES),
    ).toEqual(['api'])
  })
})
