export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result
}

export const err = <E>(error: E): Result<never, E> => ({ error, ok: false })

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

export type Result<T, E> = { error: E; ok: false } | { ok: true; value: T }
