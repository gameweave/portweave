import { existsSync, statSync } from 'node:fs'
import type { RegistryEntry } from './types.ts'

function defaultDirectoryExists(path: string): boolean {
  if (!existsSync(path)) {
    return false
  }
  try {
    return statSync(path).isDirectory()
  } catch {
    // pw-allow-swallow: statSync failure after existsSync succeeds means the path
    // was removed between the two calls. Treat as non-existent.
    return false
  }
}

export function pruneStaleEntries(
  entries: readonly RegistryEntry[],
  fsExists: (path: string) => boolean = defaultDirectoryExists,
): RegistryEntry[] {
  const kept: RegistryEntry[] = []
  for (const entry of entries) {
    if (fsExists(entry.key.worktreeRoot)) {
      kept.push(entry)
    }
  }
  return kept
}
