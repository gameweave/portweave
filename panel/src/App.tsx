import { useCallback, useEffect, useState } from 'react'

import type { PanelSnapshot } from './types.ts'

import { fetchSnapshot } from './api.ts'
import { EmptyState } from './components/EmptyState.tsx'
import { ProjectGroup } from './components/ProjectGroup.tsx'
import { useCollapseState } from './hooks/useCollapseState.ts'

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
}

export function App() {
  const [snapshot, setSnapshot] = useState<PanelSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const collapse = useCollapseState()

  const refresh = useCallback(async (options: { refresh?: boolean } = {}) => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchSnapshot({ refresh: options.refresh })
      setSnapshot(next)
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'Failed to load allocations',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // After a successful prune/open the registry / on-disk state has changed, so
  // force a triage-cache bypass to re-check immediately instead of waiting out
  // the 60 s TTL. See 02-write-actions-triage.md B-5.
  const onAction = useCallback(() => {
    void refresh({ refresh: true })
  }, [refresh])

  const projects = snapshot?.projects ?? []
  const prStatusUnavailable = snapshot !== null && !snapshot.prStatusAvailable
  const launchSupported = snapshot?.launchSupported ?? false

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title">portweave panel</h1>
          <p className="app-subtitle">
            Every allocation on this machine, with triage and quick actions.
          </p>
        </div>
        <div className="header-actions">
          {snapshot ? (
            <span className="generated-at">
              updated {formatGeneratedAt(snapshot.generatedAt)}
            </span>
          ) : null}
          <button
            type="button"
            className="refresh-button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error !== null ? (
        <div className="error-panel" role="alert">
          <span className="error-message">{error}</span>
          <button
            type="button"
            className="refresh-button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Retry
          </button>
        </div>
      ) : null}

      {prStatusUnavailable ? (
        <div className="hint-panel" role="note">
          PR status unavailable — install/authenticate <code>gh</code> to see
          per-worktree PR state.
        </div>
      ) : null}

      {loading && snapshot === null ? (
        <div className="state-panel">Loading allocations…</div>
      ) : null}

      {snapshot !== null && projects.length === 0 && error === null ? (
        <EmptyState />
      ) : null}

      {projects.map((project) => (
        <ProjectGroup
          key={project.gitCommonDir ?? project.label}
          collapse={collapse}
          launchSupported={launchSupported}
          onAction={onAction}
          project={project}
        />
      ))}
    </div>
  )
}
