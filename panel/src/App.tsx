import { useCallback, useEffect, useState } from 'react'

import type { PanelSnapshot } from './types.ts'

import { fetchSnapshot } from './api.ts'
import { EmptyState } from './components/EmptyState.tsx'
import { ProjectGroup } from './components/ProjectGroup.tsx'

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
}

export function App() {
  const [snapshot, setSnapshot] = useState<PanelSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchSnapshot()
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

  const projects = snapshot?.projects ?? []

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title">portweave panel</h1>
          <p className="app-subtitle">
            Read-only view of every allocation on this machine.
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

      {loading && snapshot === null ? (
        <div className="state-panel">Loading allocations…</div>
      ) : null}

      {snapshot !== null && projects.length === 0 && error === null ? (
        <EmptyState />
      ) : null}

      {projects.map((project) => (
        <ProjectGroup
          key={project.gitCommonDir ?? project.label}
          project={project}
        />
      ))}
    </div>
  )
}
