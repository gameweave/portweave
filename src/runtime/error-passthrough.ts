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
 */
export {
  PortweaveError,
  type PortweaveErrorCode,
  PW_ERROR_CODES,
} from '../errors.ts'
