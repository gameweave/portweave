import { describe, expect, it } from 'vitest'
import {
  PortweaveError,
  type PortweaveErrorCode,
  PW_ERROR_CODES,
} from '../errors.ts'
import { throwsPortweaveError } from './fixtures/errors-fixture.ts'

describe('PortweaveError', () => {
  it('reports its code and message', () => {
    const error = new PortweaveError(
      PW_ERROR_CODES.CONFIG_MISSING,
      'no config found',
    )
    expect(error.code).toBe('PW0101')
    expect(error.message).toBe('no config found')
    expect(error.name).toBe('PortweaveError')
  })

  it('is an instance of Error', () => {
    const error = new PortweaveError(PW_ERROR_CODES.CONFIG_INVALID, 'bad shape')
    expect(error).toBeInstanceOf(Error)
  })

  it('survives instanceof across module boundaries', () => {
    let caught: unknown
    try {
      throwsPortweaveError()
    } catch (e: unknown) {
      caught = e
    }
    expect(caught).toBeInstanceOf(PortweaveError)
    if (caught instanceof PortweaveError) {
      expect(caught.code).toBe(PW_ERROR_CODES.REGISTRY_LOCKED)
    }
  })

  it('is throwable and catchable as a typed code', () => {
    const code: PortweaveErrorCode = PW_ERROR_CODES.ALLOCATION_EXHAUSTED
    expect(() => {
      throw new PortweaveError(code, 'out of ports')
    }).toThrow(PortweaveError)
  })

  it('restores its own prototype after extends Error', () => {
    const error = new PortweaveError(PW_ERROR_CODES.CONFIG_MISSING, 'x')
    expect(Object.getPrototypeOf(error)).toBe(PortweaveError.prototype)
  })
})

describe('PW_ERROR_CODES', () => {
  it('contains the seed codes plus all component blocks with expected values', () => {
    expect(PW_ERROR_CODES).toStrictEqual({
      ALLOCATION_EXHAUSTED: 'PW0401',
      CONFIG_INVALID: 'PW0102',
      CONFIG_MISSING: 'PW0101',
      ENV_BUILD_INVALID: 'PW0501',
      ENV_DOTENV_PARSE_FAILED: 'PW0502',
      NOT_A_GIT_REPO: 'PW0201',
      REGISTRY_CORRUPT: 'PW0302',
      REGISTRY_LOCKED: 'PW0301',
      RUNTIME_CONFIG_NOT_FOUND: 'PW0701',
      RUNTIME_NOT_INITIALIZED: 'PW0702',
      WORKTREE_OFFSET_INVALID: 'PW0202',
    })
  })

  it('exposes codes as a readonly mapping', () => {
    const keys = Object.keys(PW_ERROR_CODES).sort()
    expect(keys).toStrictEqual([
      'ALLOCATION_EXHAUSTED',
      'CONFIG_INVALID',
      'CONFIG_MISSING',
      'ENV_BUILD_INVALID',
      'ENV_DOTENV_PARSE_FAILED',
      'NOT_A_GIT_REPO',
      'REGISTRY_CORRUPT',
      'REGISTRY_LOCKED',
      'RUNTIME_CONFIG_NOT_FOUND',
      'RUNTIME_NOT_INITIALIZED',
      'WORKTREE_OFFSET_INVALID',
    ])
  })

  it('values match the PW#### four-digit shape', () => {
    const shape = /^PW\d{4}$/
    for (const value of Object.values(PW_ERROR_CODES)) {
      expect(value).toMatch(shape)
    }
  })
})
