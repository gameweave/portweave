# Error Handling

Portweave follows the same error-handling contract that boardflip uses, adapted for a single-package context. Error codes use the `PW` prefix when we eventually need a diagnostic namespace.

## Decision: Result vs Throw

- **`Result<T, E>`** — fallible business logic with a typed error set the caller is expected to handle (port already bound, registry locked, config missing). Forces the caller to narrow on `result.ok` before reading `value`.
- **`throw new Error(...)`** — true invariant violations / unrecoverable / programmer error. Also acceptable for I/O wrappers where the caller is expected to let it bubble.

**Prefer `Result` over throw** when the caller has to recover. Throw is for unrecoverable conditions.

## Result helpers (TBD location)

When the first `Result<T, E>`-returning function lands in `src/`, the helpers below should live in `src/result.ts`:

```typescript
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result
}
```

## Catch-block contract

Catch variables are typed `unknown` (enforced by `@typescript-eslint/use-unknown-in-catch-callback-variable`). Always narrow before reading properties:

```typescript
try {
  // ...
} catch (caught: unknown) {
  if (caught instanceof Error) {
    log.error(caught.message)
  }
}
```

**Every catch block must end with**: a logged report, a rethrow, or producing a `Result`. No silent swallows — use a `// pw-allow-swallow: <reason>` comment in the rare case where swallowing is genuinely correct.

## OperationalError — expected failures (when we need it)

Mark expected failure modes operational so they don't pollute observability:

```typescript
export class OperationalError extends Error {
  readonly operational = true as const
  constructor(message: string) {
    super(message)
    this.name = 'OperationalError'
    Object.setPrototypeOf(this, OperationalError.prototype)
  }
}
```

Operational errors: log as warning, not error. Unexpected errors: stack trace + structured log.

## Throwing rules (ESLint-enforced)

- Always `throw new Error(...)` or a subclass. Never `throw 'string'`/`throw {}`. (`@typescript-eslint/only-throw-error`)
- `Promise.reject(new Error(...))` only. (`@typescript-eslint/prefer-promise-reject-errors`)
- No floating promises. `await`/`return`/`void`/`.catch`. (`@typescript-eslint/no-floating-promises`)
- No async callbacks where sync is expected. (`@typescript-eslint/no-misused-promises`)

These are pinned in `config/eslint/error-handling-rules.ts` so they survive future tseslint preset changes.

## Subclassing `Error`

Use when you need `instanceof` dispatch across many layers (not just within one service):

```typescript
type RegistryErrorCode = 'LOCKED' | 'STALE' | 'CORRUPT'

export class RegistryError extends Error {
  readonly code: RegistryErrorCode

  constructor(code: RegistryErrorCode, message: string) {
    super(message)
    this.name = 'RegistryError'
    this.code = code
    Object.setPrototypeOf(this, RegistryError.prototype) // load-bearing
  }
}
```

`Object.setPrototypeOf` is required — `extends Error` alone is unreliable under transpilation.

**Prefer `Result<T, ErrorCode>`** when the caller's primary need is to dispatch on the error to recover. Subclass only when many layers need `instanceof`.
