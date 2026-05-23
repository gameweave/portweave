// Local shadow of worktree-context's AllocationKey. The canonical
// definition will live at `src/worktree/key.ts` once Feature #3 ships;
// this file is deleted and imports are flipped during reconciliation.

export interface AllocationKey {
  readonly gitCommonDir: null | string
  readonly namespace: string
  readonly worktreeRoot: string
}

export interface RegistryEntry {
  readonly key: AllocationKey
  readonly lastUsedAt: string
  readonly namespace: string
  readonly ports: Readonly<Record<string, number>>
}

export interface RegistryFile {
  readonly entries: readonly RegistryEntry[]
  readonly version: 1
}

export const REGISTRY_VERSION = 1 as const
