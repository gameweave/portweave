import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { normalizePath } from './worktree-context-git.ts'

export const MAIN_NAMESPACE = 'main'

const OFFSET_ENV = 'GAMEWEAVE_WORKTREE_OFFSET'
const NAMESPACE_ENV = 'GAMEWEAVE_PM2_NAMESPACE'
const MAX_WORKTREE_OFFSET = 99
const DECIMAL_RADIX = 10
const HASH_LENGTH = 8
const MAX_SLUG_LENGTH = 40

function isOffsetLiteral(value: string): boolean {
  return /^\d+$/.test(value)
}

export function parseExplicitOffset(): null | number {
  const raw = process.env[OFFSET_ENV]
  if (raw === undefined || raw.trim().length === 0) {
    return null
  }

  if (!isOffsetLiteral(raw)) {
    throw new Error(
      `${OFFSET_ENV} must be an integer from 0 to ${String(MAX_WORKTREE_OFFSET)}`,
    )
  }

  const offset = Number.parseInt(raw, DECIMAL_RADIX)
  if (offset > MAX_WORKTREE_OFFSET) {
    throw new Error(
      `${OFFSET_ENV} must be an integer from 0 to ${String(MAX_WORKTREE_OFFSET)}`,
    )
  }

  return offset
}

export function sanitizeNamespace(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug.length === 0) {
    return MAIN_NAMESPACE
  }

  return slug.slice(0, MAX_SLUG_LENGTH)
}

export function namespaceOverride(): null | string {
  const raw = process.env[NAMESPACE_ENV]
  if (raw === undefined || raw.trim().length === 0) {
    return null
  }
  return sanitizeNamespace(raw)
}

function hashPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, HASH_LENGTH)
}

export function deriveNamespace(root: string, mainRoot: string): string {
  if (normalizePath(root) === normalizePath(mainRoot)) {
    return MAIN_NAMESPACE
  }

  const slug = sanitizeNamespace(basename(root))
  return `${slug}-${hashPath(root)}`
}
