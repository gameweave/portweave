import type { Allocation } from '../allocator/allocate.ts'

// Reserved output env var: the namespace Portweave used to allocate. Always
// injected by `buildEnvMap` and re-asserted authoritatively (see resolve.ts /
// run.ts) so both consumption modes report the same value.
export const PORTWEAVE_NAMESPACE_VAR = 'PORTWEAVE_NAMESPACE'

// Sigil prefix for portweave metadata placeholders inside discoveryEnv
// templates (e.g. `${pw:namespace}`). The colon cannot appear in a service
// name (kebab-case), so `pw:` can never collide with a `${serviceName}` ref.
export const PW_METADATA_PREFIX = 'pw:'

// Bare reserved discoveryEnv token: `${namespace}` always resolves to the
// worktree namespace — a convenience alias for `${pw:namespace}`. It is
// *reserved*, so it shadows any service literally named "namespace" in a
// template (see decision-log #37). Its value equals the `namespace` metadata
// field, so the constant doubles as that field's key.
export const RESERVED_NAMESPACE_TOKEN = 'namespace'

// 1:1 with the identity fields of AllocationKey. Each is a frozen public
// template placeholder — expose stable identity, not internals or run-state.
export type PwMetadataField = 'gitCommonDir' | 'namespace' | 'worktreeRoot'

export const PW_METADATA_FIELDS = [
  'gitCommonDir',
  RESERVED_NAMESPACE_TOKEN,
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
