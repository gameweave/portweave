import { mkdir } from 'node:fs/promises'
import { PortweaveError } from '../errors.ts'
import { err, type Result } from '../result.ts'
import { atomicWriteRegistry, pruneStaleTempFiles } from './atomic-write.ts'
import { withLock } from './lock.ts'
import { resolveRegistryPath } from './paths.ts'
import { pruneStaleEntries } from './prune.ts'
import { loadRegistryFile, serializeRegistry } from './serialize.ts'
import {
  type AllocationKey,
  REGISTRY_VERSION,
  type RegistryEntry,
  type RegistryFile,
} from './types.ts'

export interface WithRegistryHandle {
  readonly entries: readonly RegistryEntry[]
  remove: (key: AllocationKey) => void
  touch: (key: AllocationKey) => void
  upsert: (entry: RegistryEntry) => void
}

function keysEqual(a: AllocationKey, b: AllocationKey): boolean {
  return (
    a.worktreeRoot === b.worktreeRoot &&
    a.namespace === b.namespace &&
    a.gitCommonDir === b.gitCommonDir
  )
}

interface MutableHandleState {
  entries: RegistryEntry[]
  mutated: boolean
}

function buildHandle(state: MutableHandleState): WithRegistryHandle {
  return {
    /** Insertion-ordered, not sort-ordered. Callers that need sorted order must sort themselves. */
    get entries(): readonly RegistryEntry[] {
      return state.entries
    },
    remove(key) {
      const before = state.entries.length
      state.entries = state.entries.filter((e) => !keysEqual(e.key, key))
      if (state.entries.length !== before) {
        state.mutated = true
      }
    },
    touch(key) {
      const idx = state.entries.findIndex((e) => keysEqual(e.key, key))
      if (idx === -1) {
        return
      }
      const existing = state.entries[idx]
      const next: RegistryEntry = {
        key: existing.key,
        lastUsedAt: new Date().toISOString(),
        namespace: existing.namespace,
        ports: existing.ports,
      }
      state.entries = [
        ...state.entries.slice(0, idx),
        next,
        ...state.entries.slice(idx + 1),
      ]
      state.mutated = true
    },
    upsert(entry) {
      const idx = state.entries.findIndex((e) => keysEqual(e.key, entry.key))
      if (idx === -1) {
        state.entries = [...state.entries, entry]
      } else {
        state.entries = [
          ...state.entries.slice(0, idx),
          entry,
          ...state.entries.slice(idx + 1),
        ]
      }
      state.mutated = true
    },
  }
}

type InnerOutcome<T> =
  | { error: PortweaveError; kind: typeof LOAD_ERROR_KIND }
  | { kind: typeof OK_KIND; value: T }

const LOAD_ERROR_KIND = 'load-error' as const
const OK_KIND = 'ok' as const

export async function withRegistry<T>(
  fn: (handle: WithRegistryHandle) => Promise<T> | T,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<T, PortweaveError>> {
  const paths = resolveRegistryPath(env)
  await mkdir(paths.registryDir, { mode: 0o700, recursive: true })

  const lockResult = await withLock(
    paths.lockDir,
    async (): Promise<InnerOutcome<T>> => {
      await pruneStaleTempFiles(paths.registryFile)
      const loaded = await loadRegistryFile(paths.registryFile)
      if (!loaded.ok) {
        return { error: loaded.error, kind: LOAD_ERROR_KIND }
      }
      const fileBefore = loaded.value
      const prunedEntries = pruneStaleEntries(fileBefore.entries)
      const initialMutated = prunedEntries.length !== fileBefore.entries.length
      const state: MutableHandleState = {
        entries: prunedEntries,
        mutated: initialMutated,
      }
      const handle = buildHandle(state)
      const value = await fn(handle)
      if (state.mutated) {
        const nextFile: RegistryFile = {
          entries: state.entries,
          version: REGISTRY_VERSION,
        }
        await atomicWriteRegistry(
          paths.registryFile,
          serializeRegistry(nextFile),
        )
      }
      return { kind: OK_KIND, value }
    },
  )

  if (!lockResult.ok) {
    return lockResult
  }
  const inner = lockResult.value
  if (inner.kind === LOAD_ERROR_KIND) {
    return err(inner.error)
  }
  return { ok: true, value: inner.value }
}
