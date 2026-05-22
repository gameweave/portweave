import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import {
  type GitWorktreeContext,
  normalizePath,
} from './worktree-context-git.ts'
import { deriveNamespace } from './worktree-context-namespace.ts'

const REGISTRY_FILE = 'gameweave-worktree-ports.json'
const REGISTRY_LOCK_DIR = 'gameweave-worktree-ports.lock'
const REGISTRY_VERSION = 1
const MIN_WORKTREE_OFFSET = 1
const MAX_WORKTREE_OFFSET = 99
const LOCK_RETRY_COUNT = 100
const LOCK_RETRY_DELAY_MS = 25
const STALE_LOCK_MS = 30_000

export interface WorktreeContext {
  namespace: string
  offset: number
  root: string
}

interface WorktreeRegistryEntry {
  namespace: string
  offset: number
  path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasRegistryEntryShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.path === 'string' &&
    typeof value.namespace === 'string' &&
    typeof value.offset === 'number'
  )
}

function hasValidOffset(value: Record<string, unknown>): boolean {
  const offset = value.offset
  return (
    typeof offset === 'number' &&
    Number.isInteger(offset) &&
    offset >= MIN_WORKTREE_OFFSET &&
    offset <= MAX_WORKTREE_OFFSET
  )
}

function isRegistryEntry(value: unknown): value is WorktreeRegistryEntry {
  if (!isRecord(value)) {
    return false
  }

  return hasRegistryEntryShape(value) && hasValidOffset(value)
}

function readRegistry(path: string): WorktreeRegistryEntry[] {
  if (!existsSync(path)) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
      return []
    }
    return parsed.entries.filter(isRegistryEntry)
  } catch {
    return []
  }
}

function writeRegistry(path: string, entries: WorktreeRegistryEntry[]): void {
  const tempPath = `${path}.tmp`
  writeFileSync(
    tempPath,
    `${JSON.stringify({ entries, version: REGISTRY_VERSION }, null, 2)}\n`,
    'utf-8',
  )
  renameSync(tempPath, path)
}

function getErrorCode(error: unknown): string | undefined {
  if (isRecord(error)) {
    const code = error.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function waitForLockRetry(): void {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const view = new Int32Array(buffer)
  Atomics.wait(view, 0, 0, LOCK_RETRY_DELAY_MS)
}

function removeStaleLock(lockDir: string): void {
  try {
    const ageMs = Date.now() - statSync(lockDir).mtimeMs
    if (ageMs > STALE_LOCK_MS) {
      rmSync(lockDir, { force: true, recursive: true })
    }
  } catch {
    rmSync(lockDir, { force: true, recursive: true })
  }
}

function withRegistryLock<T>(gitCommonDir: string, fn: () => T): T {
  const lockDir = resolve(gitCommonDir, REGISTRY_LOCK_DIR)

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    try {
      mkdirSync(lockDir)
      try {
        return fn()
      } finally {
        rmSync(lockDir, { force: true, recursive: true })
      }
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST') {
        throw error
      }
      removeStaleLock(lockDir)
      waitForLockRetry()
    }
  }

  throw new Error(`Timed out waiting for worktree port registry lock`)
}

function pruneRegistryEntries(
  entries: WorktreeRegistryEntry[],
  activePaths: Set<string>,
): WorktreeRegistryEntry[] {
  const usedOffsets = new Set<number>()
  const pruned: WorktreeRegistryEntry[] = []

  for (const entry of entries) {
    const path = normalizePath(entry.path)
    if (!activePaths.has(path) || usedOffsets.has(entry.offset)) {
      continue
    }
    usedOffsets.add(entry.offset)
    pruned.push({ ...entry, path })
  }

  return pruned
}

function allocateOffset(entries: WorktreeRegistryEntry[]): number {
  const usedOffsets = new Set(entries.map((entry) => entry.offset))
  for (
    let offset = MIN_WORKTREE_OFFSET;
    offset <= MAX_WORKTREE_OFFSET;
    offset++
  ) {
    if (!usedOffsets.has(offset)) {
      return offset
    }
  }

  throw new Error('No worktree port offsets are available')
}

function createRegistryEntry(
  gitContext: GitWorktreeContext,
  entries: WorktreeRegistryEntry[],
): WorktreeRegistryEntry {
  const currentPath = normalizePath(gitContext.currentRoot)
  return {
    namespace: deriveNamespace(currentPath, gitContext.mainRoot),
    offset: allocateOffset(entries),
    path: currentPath,
  }
}

function toWorktreeContext(
  entry: WorktreeRegistryEntry,
  namespace: null | string,
): WorktreeContext {
  return {
    namespace: namespace ?? entry.namespace,
    offset: entry.offset,
    root: entry.path,
  }
}

export function resolveRegistryContext(
  gitContext: GitWorktreeContext,
  namespace: null | string,
): WorktreeContext {
  const registryPath = resolve(gitContext.gitCommonDir, REGISTRY_FILE)
  return withRegistryLock(gitContext.gitCommonDir, () => {
    const activePaths = new Set(gitContext.worktreeRoots.map(normalizePath))
    const entries = pruneRegistryEntries(
      readRegistry(registryPath),
      activePaths,
    )
    const currentPath = normalizePath(gitContext.currentRoot)
    const existing = entries.find((entry) => entry.path === currentPath)
    const entry = existing ?? createRegistryEntry(gitContext, entries)

    if (!existing) {
      entries.push(entry)
    }

    writeRegistry(registryPath, entries)
    return toWorktreeContext(entry, namespace)
  })
}
