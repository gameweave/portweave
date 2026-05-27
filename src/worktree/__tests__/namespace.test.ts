import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import {
  deriveNamespace,
  MAIN_NAMESPACE,
  namespaceOverride,
  parseExplicitOffset,
  sanitizeNamespace,
} from '../namespace.ts'

function sha1First8(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('MAIN_NAMESPACE', () => {
  it('is the string "main"', () => {
    expect(MAIN_NAMESPACE).toBe('main')
  })
})

describe('deriveNamespace', () => {
  it('returns MAIN_NAMESPACE when currentRoot equals mainRoot', () => {
    expect(deriveNamespace('/tmp/foo', '/tmp/foo')).toBe(MAIN_NAMESPACE)
  })

  it('emits slug-<8 hex chars> for a feature worktree of the same repo', () => {
    const out = deriveNamespace('/tmp/foo-feature-x', '/tmp/foo')
    const expectedHash = sha1First8('/tmp/foo-feature-x')
    expect(out).toBe(`foo-feature-x-${expectedHash}`)
  })

  it('matches the documented hash format spelled out in the spec', () => {
    expect(deriveNamespace('/tmp/foo-feature-x', '/tmp/foo')).toMatch(
      /^[a-z0-9-]+-[0-9a-f]{8}$/,
    )
  })

  it('is deterministic across calls', () => {
    const first = deriveNamespace('/tmp/proj-feat', '/tmp/proj')
    const second = deriveNamespace('/tmp/proj-feat', '/tmp/proj')
    expect(first).toBe(second)
  })

  it('produces the same hash for a path with and without trailing slash', () => {
    const withSlash = deriveNamespace('/tmp/foo/', '/tmp/main')
    const withoutSlash = deriveNamespace('/tmp/foo', '/tmp/main')
    expect(withSlash).toBe(withoutSlash)
  })

  it('normalizes both paths before comparing for the main short-circuit', () => {
    expect(deriveNamespace('/tmp/foo/', '/tmp/foo')).toBe(MAIN_NAMESPACE)
    expect(deriveNamespace('/tmp/foo/./.', '/tmp/foo')).toBe(MAIN_NAMESPACE)
  })
})

describe('sanitizeNamespace', () => {
  it('lowercases and collapses runs of non-alphanumerics to single dashes', () => {
    expect(sanitizeNamespace('feature/JL-123_fix!')).toBe('feature-jl-123-fix')
  })

  it('returns MAIN_NAMESPACE for empty result', () => {
    expect(sanitizeNamespace('')).toBe(MAIN_NAMESPACE)
    expect(sanitizeNamespace('---')).toBe(MAIN_NAMESPACE)
    expect(sanitizeNamespace('!!!')).toBe(MAIN_NAMESPACE)
  })

  it('truncates at 40 characters', () => {
    const long = 'a'.repeat(80)
    expect(sanitizeNamespace(long)).toBe('a'.repeat(40))
    expect(sanitizeNamespace(long)).toHaveLength(40)
  })

  it('strips leading and trailing dashes', () => {
    expect(sanitizeNamespace('---feature-x---')).toBe('feature-x')
  })
})

describe('namespaceOverride', () => {
  it('returns the sanitized value when PORTWEAVE_NAMESPACE is set', () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', 'Foo Bar!')
    expect(namespaceOverride()).toBe('foo-bar')
  })

  it('returns null when unset', () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', '')
    expect(namespaceOverride()).toBeNull()
  })

  it('returns null when whitespace-only', () => {
    vi.stubEnv('PORTWEAVE_NAMESPACE', '   ')
    expect(namespaceOverride()).toBeNull()
  })
})

describe('parseExplicitOffset', () => {
  it('returns ok(null) when unset', () => {
    vi.stubEnv('PORTWEAVE_OFFSET', '')
    const result = parseExplicitOffset()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeNull()
    }
  })

  it('returns ok(null) when whitespace-only', () => {
    vi.stubEnv('PORTWEAVE_OFFSET', '   ')
    const result = parseExplicitOffset()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeNull()
    }
  })

  it('returns ok(7) for "7"', () => {
    vi.stubEnv('PORTWEAVE_OFFSET', '7')
    const result = parseExplicitOffset()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(7)
    }
  })

  it('accepts values larger than the legacy 99-offset cap', () => {
    vi.stubEnv('PORTWEAVE_OFFSET', '500')
    const result = parseExplicitOffset()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(500)
    }
  })

  it.each([['7.5'], ['abc'], ['-1'], ['1e3'], ['0x10']])(
    'returns err WORKTREE_OFFSET_INVALID for %s',
    (raw) => {
      vi.stubEnv('PORTWEAVE_OFFSET', raw)
      const result = parseExplicitOffset()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(PortweaveError)
        expect(result.error.code).toBe(PW_ERROR_CODES.WORKTREE_OFFSET_INVALID)
      }
    },
  )
})
