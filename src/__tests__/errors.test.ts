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
      ALLOCATION_PRIMARY_SLOT_BUSY: 'PW0402',
      CLI_CHILD_SPAWN_FAILED: 'PW0602',
      CLI_INVALID_FLAGS: 'PW0601',
      CLI_NO_ALLOCATION: 'PW0603',
      CLI_PANEL_PORT_IN_USE: 'PW0604',
      CONFIG_INVALID: 'PW0102',
      CONFIG_MISSING: 'PW0101',
      ENV_BUILD_INVALID: 'PW0501',
      ENV_DOTENV_PARSE_FAILED: 'PW0502',
      ENV_DOTENV_PORT_OVERRIDE_INVALID: 'PW0503',
      GITHUB_GH_UNAVAILABLE: 'PW0801',
      GITHUB_PR_QUERY_FAILED: 'PW0802',
      NOT_A_GIT_REPO: 'PW0201',
      PANEL_LAUNCH_FAILED: 'PW0607',
      PANEL_PATH_NOT_ALLOWED: 'PW0606',
      PANEL_REQUEST_FORBIDDEN: 'PW0605',
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
      'ALLOCATION_PRIMARY_SLOT_BUSY',
      'CLI_CHILD_SPAWN_FAILED',
      'CLI_INVALID_FLAGS',
      'CLI_NO_ALLOCATION',
      'CLI_PANEL_PORT_IN_USE',
      'CONFIG_INVALID',
      'CONFIG_MISSING',
      'ENV_BUILD_INVALID',
      'ENV_DOTENV_PARSE_FAILED',
      'ENV_DOTENV_PORT_OVERRIDE_INVALID',
      'GITHUB_GH_UNAVAILABLE',
      'GITHUB_PR_QUERY_FAILED',
      'NOT_A_GIT_REPO',
      'PANEL_LAUNCH_FAILED',
      'PANEL_PATH_NOT_ALLOWED',
      'PANEL_REQUEST_FORBIDDEN',
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
