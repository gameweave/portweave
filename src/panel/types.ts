/** A resolved discovery-env entry: an env-var name and the URL it expands to. */
export interface PanelLink {
  readonly envVar: string
  readonly url: string
}

/** Whether a port currently has a listener. 'unknown' is reserved for probe error/timeout. */
export type PanelLivenessStatus = 'live' | 'not-running' | 'unknown'

/** One service within a worktree: its config label, allocated port, and resolved links. */
export interface PanelService {
  readonly envVar: string
  readonly links: readonly PanelLink[]
  readonly name: string
  readonly port: number
  readonly status: PanelLivenessStatus
}

/**
 * One worktree (namespace) under a project. `degraded` is true when the
 * worktree's config is missing/invalid or its directory is gone; in that case
 * `services` is rebuilt from raw registry ports (no links, name === envVar
 * unavailable) and `degradedReason` explains why.
 */
export interface PanelWorktree {
  readonly degraded: boolean
  readonly degradedReason: null | string
  readonly lastUsedAt: string
  readonly namespace: string
  readonly services: readonly PanelService[]
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
  readonly projects: readonly PanelProject[]
}
