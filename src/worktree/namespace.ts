import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { normalizePath } from './git.ts'

export const MAIN_NAMESPACE = 'main'

const DECIMAL_RADIX = 10
const HASH_LENGTH = 8
const MAX_SLUG_LENGTH = 40
const NAMESPACE_ENV = 'PORTWEAVE_NAMESPACE'
const OFFSET_ENV = 'PORTWEAVE_OFFSET'

const NON_SLUG_CHARS = /[^a-z0-9]+/g
const SURROUNDING_DASHES = /^-+|-+$/g
const OFFSET_LITERAL = /^\d+$/

export function deriveNamespace(currentRoot: string, mainRoot: string): string {
  if (normalizePath(currentRoot) === normalizePath(mainRoot)) {
    return MAIN_NAMESPACE
  }

  const slug = sanitizeNamespace(basename(currentRoot))
  return `${slug}-${hashPath(currentRoot)}`
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
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.WORKTREE_OFFSET_INVALID,
        `${OFFSET_ENV} must be a non-negative integer within Number.MAX_SAFE_INTEGER (got "${raw}")`,
      ),
    )
  }

  return ok(offset)
}

export function sanitizeNamespace(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(NON_SLUG_CHARS, '-')
    .replace(SURROUNDING_DASHES, '')

  if (slug.length === 0) {
    return MAIN_NAMESPACE
  }

  return slug.slice(0, MAX_SLUG_LENGTH)
}

function hashPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, HASH_LENGTH)
}
