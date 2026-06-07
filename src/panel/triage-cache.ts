
import { fetchPrStatus, ghIsAvailable } from '../github/pr-status.ts'
import { worktreeBranch } from '../worktree/branch.ts'
import { detectGitWorktreeContext, normalizePath } from '../worktree/git.ts'
import { worktreeIsClean } from '../worktree/status.ts'
import type { PanelPrStatus, WorktreeKind } from './types.ts'
import { diskSizeBytes } from './disk-size.ts'

/** Per-worktree triage cache lifetime: signals (PR/clean/size) change slowly. */
export const PANEL_TRIAGE_TTL_MS = 60_000 as const

export interface WorktreeTriage {
  readonly branch: null | string
  readonly diskSizeBytes: null | number
  readonly kind: WorktreeKind
  readonly prStatus: null | PanelPrStatus
  readonly workingTreeClean: boolean | null
}

export interface TriageProvider {
  readonly prStatusAvailable: boolean
  triageFor: (worktreeRoot: string, force?: boolean) => Promise<WorktreeTriage>
}

/**
 * Injectable boundary deps + clock so caching/TTL can be unit-tested without
 * shelling out to real gh/git/du. Production call sites pass nothing; each entry
 * defaults to the real import (or the system clock).
 */
export interface TriageDeps {
  readonly detectKind?: (worktreeRoot: string) => WorktreeKind
  readonly diskSizeBytes?: (worktreeRoot: string) => Promise<null | number>
  readonly fetchPrStatus?: (worktreeRoot: string) => Promise<null | PanelPrStatus>
  readonly ghIsAvailable?: () => boolean
  readonly now?: () => number
  readonly worktreeBranch?: (worktreeRoot: string) => null | string
  readonly worktreeIsClean?: (worktreeRoot: string) => boolean | null
}

export interface CreateTriageProviderOptions {
  readonly deps?: TriageDeps
}

interface CacheEntry {
  readonly stampedAt: number
  readonly triage: WorktreeTriage
}

type ResolvedDeps = Required<TriageDeps>

// Derive main-vs-linked from the git common context's mainRoot (git lists the
// main checkout first), not the namespace: MAIN_NAMESPACE is overridable, so it
// is an unreliable proxy. Not-a-git-repo / err collapses to 'linked'.
function detectKindFromGit(worktreeRoot: string): WorktreeKind {
  const context = detectGitWorktreeContext(worktreeRoot)
  if (!context.ok) {
    return 'linked'
  }
  return normalizePath(worktreeRoot) === context.value.mainRoot
    ? 'main'
    : 'linked'
}

// Production defaults for every injectable dep; tests override per-key. Resolved
// in one spread inside createTriageProvider so the merge stays a single branch.
const DEFAULT_DEPS: ResolvedDeps = {
  detectKind: detectKindFromGit,
  diskSizeBytes,
  fetchPrStatus,
  ghIsAvailable,
  now: Date.now,
  worktreeBranch,
  worktreeIsClean,
}

function isFresh(entry: CacheEntry | undefined, now: number): entry is CacheEntry {
  return entry !== undefined && now - entry.stampedAt < PANEL_TRIAGE_TTL_MS
}

async function computeTriage(
  worktreeRoot: string,
  deps: ResolvedDeps,
  prStatusAvailable: boolean,
): Promise<WorktreeTriage> {
  const [prStatus, diskSize] = await Promise.all([
    prStatusAvailable
      ? deps.fetchPrStatus(worktreeRoot)
      : Promise.resolve<null | PanelPrStatus>(null),
    deps.diskSizeBytes(worktreeRoot),
  ])

  return {
    branch: deps.worktreeBranch(worktreeRoot),
    diskSizeBytes: diskSize,
    kind: deps.detectKind(worktreeRoot),
    prStatus,
    workingTreeClean: deps.worktreeIsClean(worktreeRoot),
  }
}

export function createTriageProvider(
  options?: CreateTriageProviderOptions,
): TriageProvider {
  const deps: ResolvedDeps = { ...DEFAULT_DEPS, ...(options?.deps ?? {}) }

  const prStatusAvailable = deps.ghIsAvailable()

  const cache = new Map<string, CacheEntry>()

  // `force` (per call, from ?refresh=1) skips the freshness check, recomputes,
  // and still writes the fresh entry back — so it warms the cache for the next
  // ordinary read rather than leaving stale data behind.
  async function triageFor(
    worktreeRoot: string,
    force = false,
  ): Promise<WorktreeTriage> {
    const cached = cache.get(worktreeRoot)
    if (!force && isFresh(cached, deps.now())) {
      return cached.triage
    }

    const triage = await computeTriage(worktreeRoot, deps, prStatusAvailable)
    cache.set(worktreeRoot, { stampedAt: deps.now(), triage })
    return triage
  }

  return { prStatusAvailable, triageFor }
}
