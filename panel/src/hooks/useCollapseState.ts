import { useCallback, useState } from 'react'

// Persisted set of collapsed project/worktree IDs. The panel is served
// same-origin from http://127.0.0.1:<port>, so localStorage is stable
// per-origin across Refresh clicks and process restarts on the same port.
//
// Every localStorage access and the JSON.parse are guarded: a storage error
// (private-mode / disabled storage / corrupt value) falls back to in-memory
// state so the panel never breaks over a storage failure. This is the
// no-silent-throw spirit of .claude/rules/error-handling.md applied in the
// frontend — we degrade rather than crash.

const STORAGE_KEY = 'portweave-panel:collapsed'

function readPersisted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return new Set()
    }
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string'))
    }
    return new Set()
  } catch {
    // pw-allow-swallow: storage unavailable/corrupt — fall back to in-memory
    return new Set()
  }
}

function writePersisted(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // pw-allow-swallow: storage unavailable — in-memory state still updated
  }
}

export interface CollapseState {
  readonly collapsed: ReadonlySet<string>
  isCollapsed: (id: string) => boolean
  toggle: (id: string) => void
}

export function useCollapseState(): CollapseState {
  const [collapsed, setCollapsed] = useState<Set<string>>(readPersisted)

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      writePersisted(next)
      return next
    })
  }, [])

  const isCollapsed = useCallback(
    (id: string) => collapsed.has(id),
    [collapsed],
  )

  return { collapsed, isCollapsed, toggle }
}
