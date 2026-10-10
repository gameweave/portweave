import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { normalizePath } from './git.ts'

export const MAIN_NAMESPACE = 'main'

const DECIMAL_RADIX = 10
const HASH_LENGTH = 8
const MAX_NAMESPACE_LENGTH = 40
// A derived namespace is `<slug>-<hash>`, so the slug gets what is left of the
// namespace budget after the dash and the hash. Capping the slug (rather than
// the joined string) keeps every derived namespace within MAX_NAMESPACE_LENGTH,
// which is what lets it survive a round trip through PORTWEAVE_NAMESPACE.
const MAX_DERIVED_SLUG_LENGTH = MAX_NAMESPACE_LENGTH - HASH_LENGTH - 1
const NAMESPACE_ENV = 'PORTWEAVE_NAMESPACE'
const OFFSET_ENV = 'PORTWEAVE_OFFSET'

const NON_SLUG_CHARS = /[^a-z0-9]+/g
const SURROUNDING_DASHES = /^-+|-+$/g
const OFFSET_LITERAL = /^\d+$/

export function deriveNamespace(currentRoot: string, mainRoot: string): string {
  const normalized = normalizePath(currentRoot)
  if (normalized === normalizePath(mainRoot)) {
    return MAIN_NAMESPACE
  }

  const slug = sanitizeNamespace(basename(normalized), MAX_DERIVED_SLUG_LENGTH)
  return `${slug}-${hashPath(normalized)}`
}

export function namespaceOverride(): null | string {
  const raw = process.env[NAMESPACE_ENV]
  if (raw === undefined || raw.trim().length === 0) {
    return null
  }
  return sanitizeNamespace(raw)
}

export function parseExplicitOffset(): Result<null | number, PortweaveError> {
  const raw = process.env[OFFSET_ENV]
  if (raw === undefined || raw.trim().length === 0) {
    return ok(null)
  }

  if (!OFFSET_LITERAL.test(raw.trim())) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.WORKTREE_OFFSET_INVALID,
        `${OFFSET_ENV} must be a non-negative integer (got "${raw}")`,
      ),
    )
  }

  const offset = Number.parseInt(raw.trim(), DECIMAL_RADIX)
  // guard against digit strings exceeding Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(offset)) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.WORKTREE_OFFSET_INVALID,
        `${OFFSET_ENV} must be a non-negative integer within Number.MAX_SAFE_INTEGER (got "${raw}")`,
      ),
    )
  }

  return ok(offset)
}

/**
 * Normalize `value` to a namespace slug of at most `maxLength` characters.
 *
 * Idempotent: `sanitizeNamespace(sanitizeNamespace(x)) === sanitizeNamespace(x)`.
 * `portweave run` hands the namespace it allocated under to its child as
 * `PORTWEAVE_NAMESPACE`, and a child that re-enters Portweave (the runtime API
 * from a dev server's config, a nested `portweave run`) reads it back through
 * `namespaceOverride()` → this function. Any value this function or
 * `deriveNamespace` emits must therefore come back unchanged, or the child
 * resolves a different namespace and gets a second allocation. Hence the
 * dashes are stripped again after truncation: a cut landing just after a dash
 * would otherwise leave a trailing dash that the next pass removes.
 */
export function sanitizeNamespace(
  value: string,
  maxLength: number = MAX_NAMESPACE_LENGTH,
): string {
  const slug = value
    .toLowerCase()
    .replace(NON_SLUG_CHARS, '-')
    .replace(SURROUNDING_DASHES, '')
    .slice(0, maxLength)
    .replace(SURROUNDING_DASHES, '')

  if (slug.length === 0) {
    return MAIN_NAMESPACE
  }

  return slug
}

function hashPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, HASH_LENGTH)
}
