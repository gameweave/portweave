import type { PanelLivenessStatus } from '../types.ts'

const LABELS: Record<PanelLivenessStatus, string> = {
  live: 'live',
  'not-running': 'not running',
  unknown: 'unknown',
}

export function LivenessBadge({ status }: { status: PanelLivenessStatus }) {
  return (
    <span
      className={`liveness-badge liveness-${status}`}
      title={`port status: ${LABELS[status]}`}
    >
      <span className="liveness-dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  )
}
