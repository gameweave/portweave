import type { PortweaveError } from '../errors.ts'
import type { AllocationKey } from '../worktree/key.ts'
import { type Result } from '../result.ts'
import { withRegistry } from '../registry/storage.ts'

/**
 * Validate a parsed prune request body into an {@link AllocationKey}, or
 * `undefined` when a field has the wrong type. `worktreeRoot`/`namespace` must
 * be strings and `gitCommonDir` must be `string | null` — so the panel route
 * 400s a malformed body instead of casting through unchecked `unknown`.
 */
export function parsePruneKey(
  body: Record<string, unknown>,
): AllocationKey | undefined {
  const { gitCommonDir, namespace, worktreeRoot } = body
  if (
    typeof worktreeRoot !== 'string' ||
    typeof namespace !== 'string' ||
    (gitCommonDir !== null && typeof gitCommonDir !== 'string')
  ) {
    return undefined
  }
  return { gitCommonDir, namespace, offsetOverride: null, worktreeRoot }
}

/**
 * Removes the allocation for `key` via the locked read-modify-write primitive.
 * `removed` is false when no entry matched. Reuses {@link withRegistry}'s
 * `handle.remove` (which filters by keysEqual) rather than reimplementing the
 * key comparison — removal is detected via the entry-count delta, so a no-match
 * remove leaves `mutated` false and writes nothing.
 *
 * Shared by the `portweave prune` CLI command and the panel's POST /api/prune
 * route — one prune code path.
 */
export function pruneAllocation(
  key: AllocationKey,
  env: NodeJS.ProcessEnv,
): Promise<Result<{ readonly removed: boolean }, PortweaveError>> {
  return withRegistry((handle) => {
    const before = handle.entries.length
    handle.remove(key)
    return { removed: handle.entries.length < before }
  }, env)
}
