import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import type { PanelPrStatus, PrState } from '../panel/types.ts'

const execFileAsync = promisify(execFile)

/** Stdout/stderr from a finished `gh` invocation. Mirrors execFileAsync's resolve shape. */
export interface GhRun {
  readonly stdout: string
}

/** Injectable `gh` runner so tests never need a real authenticated gh. */
export type RunGh = (args: readonly string[], cwd: string) => Promise<GhRun>

const PR_VIEW_ARGS = ['pr', 'view', '--json', 'state,number,url'] as const

const PR_STATE_BY_GH: Readonly<Record<string, PrState>> = {
  CLOSED: 'closed',
  MERGED: 'merged',
  OPEN: 'open',
}

async function defaultRunGh(
  args: readonly string[],
  cwd: string,
): Promise<GhRun> {
  const { stdout } = await execFileAsync('gh', [...args], { cwd })
  return { stdout }
}

/** gh present AND authenticated: `gh auth status` exits 0. Binary missing (ENOENT) → false. */
export function ghIsAvailable(): boolean {
  const result = spawnSync('gh', ['auth', 'status'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // spawnSync sets `error` (ENOENT) when the binary is absent and leaves status null.
  return result.error === undefined && result.status === 0
}

function normalizePrState(raw: unknown): null | PrState {
  return typeof raw === 'string' ? (PR_STATE_BY_GH[raw] ?? null) : null
}

function parsePrStatus(stdout: string): null | PanelPrStatus {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    // pw-allow-swallow: gh optional — absence is a valid state
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const record = parsed as Record<string, unknown>
  const state = normalizePrState(record.state)
  if (state === null) {
    return null
  }
  return {
    number: typeof record.number === 'number' ? record.number : null,
    state,
    url: typeof record.url === 'string' ? record.url : null,
  }
}

/**
 * PR state for the current branch of `worktreeRoot`, or null when there is no PR /
 * a non-GitHub remote / gh failed. Never throws — absence is a valid state. Slow
 * (network), so callers run these concurrently and cache. `runGh` is injectable
 * for tests; the primary call site passes one arg.
 */
export async function fetchPrStatus(
  worktreeRoot: string,
  runGh: RunGh = defaultRunGh,
): Promise<null | PanelPrStatus> {
  try {
    const { stdout } = await runGh(PR_VIEW_ARGS, worktreeRoot)
    return parsePrStatus(stdout)
  } catch {
    // pw-allow-swallow: gh optional — absence is a valid state
    return null
  }
}
