# Result types and PW error codes

**Status:** shipped
**Owner:** TBD
**Feature doc:** [.ai/features/result-types/result-types.md](../../features/result-types/result-types.md)
**Decision-log rows:** Foundation — no existing row. This spec also establishes the `PW` numeric-range convention; if accepted, append a new row to [.ai/decision-log.md](../../decision-log.md) noting the scheme.

## Problem

Every v0 feature past this point — config loading, registry I/O, allocator, CLI — runs fallible operations against shared filesystem state and needs the _caller_ to recover (retry on lock contention, surface a typed error, fall back to a default). Without a shared `Result<T, E>` primitive and a unified `PW`-prefixed error-code namespace, each feature would either reinvent the pattern locally or fall back to throw-everywhere, leaking implementation noise across module boundaries and giving CLI users no stable surface to script against.

[.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md) already pins the contract (helper signatures, catch-block rules, `Object.setPrototypeOf` for `instanceof` safety). This feature is the first place that contract becomes code so the next four features can build on it from day one.

## Approach

Two source files plus a tests directory, all under `src/`. Re-export the public surface from [src/index.ts](../../../src/index.ts) so library consumers have a single import root.

### `src/result.ts` — Result primitives

Mirror the signatures from [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md) verbatim:

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

The discriminant `ok: boolean` lets callers narrow without casts. Nothing else lands here at v0 — no `map`, no `unwrap`, no async wrappers. They get added when a real caller needs them.

### `src/errors.ts` — `PortweaveError` and the `PW` code namespace

Define a `PW_ERROR_CODES` const object as the source of truth, then derive the union type:

```typescript
export const PW_ERROR_CODES = {
  CONFIG_MISSING: 'PW0101',
  CONFIG_INVALID: 'PW0102',
  REGISTRY_LOCKED: 'PW0301',
  REGISTRY_CORRUPT: 'PW0302',
  ALLOCATION_EXHAUSTED: 'PW0401',
} as const

export type PortweaveErrorCode =
  (typeof PW_ERROR_CODES)[keyof typeof PW_ERROR_CODES]

export class PortweaveError extends Error {
  readonly code: PortweaveErrorCode

  constructor(code: PortweaveErrorCode, message: string) {
    super(message)
    this.name = 'PortweaveError'
    this.code = code
    Object.setPrototypeOf(this, PortweaveError.prototype)
  }
}
```

`Object.setPrototypeOf` is load-bearing — without it `instanceof PortweaveError` is unreliable under transpilation (see error-handling.md §"Subclassing Error").

#### PW number-range scheme (resolves the feature doc's open question)

`PW` codes are four-digit numerics, grouped by component in 100-blocks:

| Range         | Component                                                                |
| ------------- | ------------------------------------------------------------------------ |
| `PW0001–0099` | Foundation / cross-cutting (Result misuse, generic invariant violations) |
| `PW0101–0199` | Config loading                                                           |
| `PW0201–0299` | Worktree context                                                         |
| `PW0301–0399` | Registry storage                                                         |
| `PW0401–0499` | Port allocator                                                           |
| `PW0501–0599` | Env resolution                                                           |
| `PW0601–0699` | CLI                                                                      |
| `PW0701–0799` | Library runtime                                                          |
| `PW0801+`     | Reserved for future components                                           |

Within a component, codes are assigned in the order they're added; gaps are fine, never renumber a published code. The seed codes above occupy the first slot of each block that Features 2–5 need.

The mnemonic `PW_ERROR_CODES.CONFIG_MISSING` is the stable referent in source; the numeric `PW0101` is what shows up in user-facing diagnostics, logs, and (eventually) docs.

### `src/index.ts` — public re-export

Replace the current `export {}` stub with named re-exports of `Result`, `ok`, `err`, `andThen`, `PortweaveError`, `PortweaveErrorCode`, and `PW_ERROR_CODES`. Library consumers and downstream features import from `'portweave'` (or relative paths during build) rather than reaching into subpaths.

### Tests — `src/__tests__/result.test.ts` and `src/__tests__/errors.test.ts`

Per [.claude/rules/testing.md](../../../.claude/rules/testing.md), tests live under `src/__tests__/` with one file per source file.

`result.test.ts`:

- `ok(x).value === x` and `ok(x).ok === true`
- `err(e).error === e` and `err(e).ok === false`
- `andThen` chains success through, short-circuits on failure, preserves the error type
- Type-only smoke: a fixture file under `src/__tests__/fixtures/` imports `Result` as a type-only import and compiles without runtime overhead (verified by `typecheck` step in `dev-workflow`, not a runtime assertion)

`errors.test.ts`:

- A `PortweaveError` instance reports its `code` and `message`
- `instanceof PortweaveError` returns true when the error is constructed in one helper module and caught in another — set up the cross-module case with a sibling fixture file under `src/__tests__/fixtures/` that exports a `throwsPortweaveError()` function; the test imports it, calls it inside `try`, and asserts `instanceof` in `catch`
- All five seed codes are present on `PW_ERROR_CODES` with the expected `PW####` string values

No file-system or process tests at this layer — that pressure lands when Features 3–4 add real registry I/O.

## Acceptance criteria

- [ ] `src/result.ts` exports `Result<T, E>`, `ok`, `err`, `andThen` with the exact signatures shown in [.claude/rules/error-handling.md](../../../.claude/rules/error-handling.md).
- [ ] `Result<T, E>` narrows under TypeScript without casts: a function returning `Result<number, string>` and a caller branching on `result.ok` type-checks under `strict` + `verbatimModuleSyntax`.
- [ ] `src/errors.ts` exports `PortweaveError`, `PortweaveErrorCode`, and `PW_ERROR_CODES` containing exactly the five seed entries (`CONFIG_MISSING`, `CONFIG_INVALID`, `REGISTRY_LOCKED`, `REGISTRY_CORRUPT`, `ALLOCATION_EXHAUSTED`) with the numeric values from the PW range table above.
- [ ] `new PortweaveError(code, msg) instanceof PortweaveError` returns `true` when the error is thrown from one module file and caught in another (verified by `src/__tests__/errors.test.ts` using a sibling fixture file).
- [ ] `src/index.ts` re-exports the public surface; `import { ok, err, PortweaveError } from '../../index.ts'` works from any descendant module.
- [ ] `import type { Result } from '../../result.ts'` resolves with no runtime side effects (verified by `typecheck`; the import does not appear in transpiled JS).
- [ ] `npm run dev-workflow` is green at the end of the feature, including `test` (with coverage thresholds met for the two new source files), `lint`, `typecheck`, and `structure:check`.
- [ ] A row in [.ai/decision-log.md](../../decision-log.md) records the PW numbering scheme so future features have a single place to reference.

## Open questions

- None blocking implementation. The PW number-range scheme is recommended above; spec approval ratifies it. If the recommendation changes during review, update the table before promoting `Status: approved`.
