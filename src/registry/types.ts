import type { AllocationKey } from '../worktree/key.ts'

export type { AllocationKey }

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
