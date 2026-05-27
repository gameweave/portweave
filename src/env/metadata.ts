import type { Allocation } from '../allocator/allocate.ts'

// Reserved output env var: the namespace Portweave used to allocate. Always
// injected by `buildEnvMap` and re-asserted authoritatively (see resolve.ts /
// run.ts) so both consumption modes report the same value.
export const PORTWEAVE_NAMESPACE_VAR = 'PORTWEAVE_NAMESPACE'

// Sigil prefix for portweave metadata placeholders inside discoveryEnv
// templates (e.g. `${pw:namespace}`). The colon cannot appear in a service
// name (kebab-case), so `pw:` can never collide with a `${serviceName}` ref.
export const PW_METADATA_PREFIX = 'pw:'

// 1:1 with the identity fields of AllocationKey. Each is a frozen public
// template placeholder — expose stable identity, not internals or run-state.
export type PwMetadataField = 'gitCommonDir' | 'namespace' | 'worktreeRoot'

export const PW_METADATA_FIELDS = [
  'gitCommonDir',
  'namespace',
  'worktreeRoot',
] as const satisfies readonly PwMetadataField[]

export function buildMetadata(
  allocation: Allocation,
): Record<PwMetadataField, string> {
  return {
    // null outside a git repo → empty string (documented, never throws)
    gitCommonDir: allocation.key.gitCommonDir ?? '',
    namespace: allocation.namespace,
    worktreeRoot: allocation.key.worktreeRoot,
  }
}
