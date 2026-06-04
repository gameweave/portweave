import type { PanelWorktree } from '../types.ts'

import { ServiceRow } from './ServiceRow.tsx'

export function WorktreeCard({ worktree }: { worktree: PanelWorktree }) {
  return (
    <div className="worktree-card">
      <div className="worktree-header">
        <span className="worktree-namespace">{worktree.namespace}</span>
        {worktree.degraded ? (
          <span className="degraded-marker">
            <span className="degraded-badge">degraded</span>
            {worktree.degradedReason ? (
              <span className="degraded-reason">{worktree.degradedReason}</span>
            ) : null}
          </span>
        ) : null}
        <span className="worktree-root" title={worktree.worktreeRoot}>
          {worktree.worktreeRoot}
        </span>
      </div>
      {worktree.services.length > 0 ? (
        worktree.services.map((service) => (
          <ServiceRow key={service.name} service={service} />
        ))
      ) : (
        <div className="worktree-empty">No services allocated.</div>
      )}
    </div>
  )
}
