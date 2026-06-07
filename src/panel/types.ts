/** A resolved discovery-env entry: an env-var name and the URL it expands to. */
export interface PanelLink {
  readonly envVar: string
  readonly url: string
}

/** Whether a port currently has a listener. 'unknown' is reserved for probe error/timeout. */
export type PanelLivenessStatus = 'live' | 'not-running' | 'unknown'

/** main checkout vs a linked worktree (git lists the main checkout first). */
export type WorktreeKind = 'linked' | 'main'

/** GitHub PR state for a worktree's branch. Absent (null) when unknown. */
export type PrState = 'closed' | 'merged' | 'open'

/** One service within a worktree: its config label, allocated port, and resolved links. */
export interface PanelService {
  readonly envVar: string
  readonly links: readonly PanelLink[]
  readonly name: string
  readonly port: number
  readonly status: PanelLivenessStatus
}

/** PR status for a worktree's branch; null when gh is unavailable / no PR. */
export interface PanelPrStatus {
  readonly number: null | number
  readonly state: PrState
  readonly url: null | string
}

/**
 * One worktree (namespace) under a project. `degraded` is true when the
 * worktree's config is missing/invalid or its directory is gone; in that case
 * `services` is rebuilt from raw registry ports (no links, name === envVar
 * unavailable) and `degradedReason` explains why.
 */
export interface PanelWorktree {
  readonly branch: null | string // null = detached HEAD / git unavailable / degraded
  readonly degraded: boolean
  readonly degradedReason: null | string
  readonly diskSizeBytes: null | number // null = not computed / unavailable / non-du platform
  readonly kind: WorktreeKind
  readonly lastUsedAt: string
  readonly namespace: string
  readonly prStatus: null | PanelPrStatus // null = no PR, non-GitHub remote, or gh unavailable
  readonly removeCommand: string // copyable `git worktree remove <root>` (safe, non-force form)
  readonly safeToPrune: boolean // linked && PR merged/closed && working tree clean
  readonly services: readonly PanelService[]
  readonly workingTreeClean: boolean | null // null = git status failed / unknown
  readonly worktreeRoot: string
}

/** One project, keyed by git common dir. `label` is the explicit config `projectName` when set, else a name derived from `gitCommonDir` ('(no repo)' when null). */
export interface PanelProject {
  readonly gitCommonDir: null | string
  readonly label: string
  readonly worktrees: readonly PanelWorktree[]
}

/** The whole machine view. `generatedAt` is when this snapshot was built. */
export interface PanelSnapshot {
  readonly generatedAt: string
  readonly launchSupported: boolean // process.platform === 'darwin' for v1
  readonly projects: readonly PanelProject[]
  readonly prStatusAvailable: boolean // gh present + authenticated machine-wide
}
