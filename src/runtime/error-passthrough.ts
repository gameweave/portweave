/**
 * Error passthrough contract for the runtime library.
 *
 * The runtime functions pass upstream errors through to the caller unchanged —
 * the `code` and `message` from the originating module reach the top-level
 * `Result.error` without wrapping. This module documents and re-exports the
 * error codes the runtime can surface, so callers can dispatch on them.
 *
 * See .ai/specs/library-runtime/library-runtime.md §Error handling for the
 * full error table.
 *
 * Module note: structure:check pairs every `*.test.ts` with a sibling source
 * file. `error-passthrough.test.ts` (which asserts the passthrough contract)
 * pairs with this file. The re-exports are intentionally thin — the canonical
 * definitions live in `../errors.ts`. This module is listed in `knip.json`'s
 * `ignoreExportsUsedInFile` because its exports are only consumed by the
 * sibling test.
 */
export {
  PortweaveError,
  type PortweaveErrorCode,
  PW_ERROR_CODES,
} from '../errors.ts'
