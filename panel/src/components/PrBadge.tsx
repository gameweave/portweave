import type { PanelPrStatus } from '../types.ts'

// Color cue per PR state, driven by CSS vars so the dark theme stays the single
// source of truth: open=green-ish, merged=purple-ish, closed=red-ish.
const STATE_LABELS: Record<PanelPrStatus['state'], string> = {
  closed: 'closed',
  merged: 'merged',
  open: 'open',
}

export function PrBadge({ prStatus }: { prStatus: PanelPrStatus }) {
  const label = STATE_LABELS[prStatus.state]
  const text =
    prStatus.number === null ? `PR ${label}` : `PR #${String(prStatus.number)} ${label}`
  const className = `pr-badge pr-${prStatus.state}`

  if (prStatus.url !== null) {
    return (
      <a
        className={className}
        href={prStatus.url}
        target="_blank"
        rel="noreferrer"
        title={prStatus.url}
      >
        {text}
      </a>
    )
  }

  return <span className={className}>{text}</span>
}
