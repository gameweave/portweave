import type { PanelSnapshot } from './types.ts'

// Relative URLs work because the app is served same-origin by the panel server
// (and proxied to the backend in dev). See 02-frontend.md "Data flow".

const CSRF_HEADER = 'X-Portweave-CSRF'

// The server injects a per-session CSRF token into the served index.html as
// <meta name="pw-csrf" content="…">. The frontend reads it here and sends it on
// every mutating request. A cross-origin attacker cannot read the token
// (same-origin policy blocks reading the HTML body), so cannot forge the header.
// See 02-write-actions-triage.md B-7.
function readCsrfToken(): null | string {
  return (
    document
      .querySelector('meta[name="pw-csrf"]')
      ?.getAttribute('content') ?? null
  )
}

export interface FetchSnapshotOptions {
  /** Force a triage-cache bypass so freshly-merged PRs / deleted dirs re-check now. */
  readonly refresh?: boolean
}

export async function fetchSnapshot(
  options: FetchSnapshotOptions = {},
): Promise<PanelSnapshot> {
  const path = options.refresh ? '/api/allocations?refresh=1' : '/api/allocations'
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`Request failed: ${String(res.status)} ${res.statusText}`)
  }
  return (await res.json()) as PanelSnapshot
}

export interface PruneRequest {
  readonly gitCommonDir: null | string
  readonly namespace: string
  readonly worktreeRoot: string
}

export interface PruneResult {
  readonly removed: boolean
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = readCsrfToken()
  if (token !== null) {
    headers[CSRF_HEADER] = token
  }
  const res = await fetch(path, {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${String(res.status)} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export async function prune(request: PruneRequest): Promise<PruneResult> {
  return postJson<PruneResult>('/api/prune', { ...request, confirm: true })
}

export interface OpenRequest {
  readonly target: 'editor' | 'terminal'
  readonly worktreeRoot: string
}

export interface OpenResult {
  readonly launched: boolean
  readonly reason?: string
}

export async function open(request: OpenRequest): Promise<OpenResult> {
  return postJson<OpenResult>('/api/open', request)
}
