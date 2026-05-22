import { describe, expect, expectTypeOf, it } from 'vitest'
import { andThen, err, ok, type Result } from '../result.ts'
import type { SmokeErr, SmokeOk } from './fixtures/result-fixture.ts'

describe('ok', () => {
  it('wraps a value in a successful Result', () => {
    const result = ok(42)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(42)
    }
  })

  it('discriminates as ok=true at the type level', () => {
    const result = ok('hello')
    expectTypeOf(result).toEqualTypeOf<Result<string, never>>()
  })
})

describe('err', () => {
  it('wraps an error in a failed Result', () => {
    const result = err('boom')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('boom')
    }
  })

  it('discriminates as ok=false at the type level', () => {
    const result = err({ code: 'X' })
    expectTypeOf(result).toEqualTypeOf<Result<never, { code: string }>>()
  })
})

describe('andThen', () => {
  it('chains a successful step onto a prior success', () => {
    const result = andThen(ok(2), (value) => ok(value * 3))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(6)
    }
  })

  it('short-circuits when the prior step failed', () => {
    const result = andThen<number, number, string>(err('upstream'), (value) =>
      ok(value * 3),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('upstream')
    }
  })

  it('propagates a downstream failure', () => {
    const result = andThen<number, number, string>(ok(2), () =>
      err('downstream'),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('downstream')
    }
  })

  it('preserves the error type across the chain', () => {
    interface CustomError {
      code: 'A' | 'B'
    }
    const start: Result<number, CustomError> = err({ code: 'A' })
    const result = andThen(start, (value) => ok(value + 1))
    expectTypeOf(result).toEqualTypeOf<Result<number, CustomError>>()
  })
})

describe('Result narrowing', () => {
  it('narrows without casts when branching on result.ok', () => {
    function classify(input: Result<number, string>): string {
      if (input.ok) {
        return `value:${input.value.toString()}`
      }
      return `error:${input.error}`
    }
    expect(classify(ok(5))).toBe('value:5')
    expect(classify(err('nope'))).toBe('error:nope')
  })

  it('matches the type-only fixture aliases', () => {
    expectTypeOf<SmokeOk>().toEqualTypeOf<Result<number, string>>()
    expectTypeOf<SmokeErr>().toEqualTypeOf<Result<never, { code: 'X' }>>()
  })
})
