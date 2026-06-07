import type { WorktreeTriage } from './triage-cache.ts'
import { deriveRemoveCommand, deriveSafeToPrune } from './triage.ts'
import type { PanelWorktree } from './types.ts'

// Safe defaults when no TriageProvider is injected (minimal/legacy callers): the
// required PanelWorktree triage fields are always populated, with the most
// conservative values (linked, no PR, clean-state unknown, size unavailable).
export const DEFAULT_TRIAGE: WorktreeTriage = {
  branch: null,
  diskSizeBytes: null,
  kind: 'linked',
  prStatus: null,
  workingTreeClean: null,
}

type TriageFields = Pick<
  PanelWorktree,
  | 'branch'
  | 'diskSizeBytes'
  | 'kind'
  | 'prStatus'
  | 'removeCommand'
  | 'safeToPrune'
  | 'workingTreeClean'
>

// Map a worktree's triage signals onto the six derived PanelWorktree fields.
// removeCommand is always computed (even for a degraded worktree); safeToPrune
// folds kind + PR state + clean state through the conservative B-3 rule.
export function stampTriage(
  triage: WorktreeTriage,
  worktreeRoot: string,
): TriageFields {
  return {
    branch: triage.branch,
    diskSizeBytes: triage.diskSizeBytes,
    kind: triage.kind,
    prStatus: triage.prStatus,
    removeCommand: deriveRemoveCommand(worktreeRoot),
    safeToPrune: deriveSafeToPrune({
      kind: triage.kind,
      prStatus: triage.prStatus,
      workingTreeClean: triage.workingTreeClean,
    }),
    workingTreeClean: triage.workingTreeClean,
  }
}
