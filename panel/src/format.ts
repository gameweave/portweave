// Human-readable byte formatting for the on-disk size signal. Uses binary units
// (1 KB = 1024 B) to match `du`'s KB blocks (the backend computes via `du -sk`).
// Returns an em dash for null (size not computed / unavailable / non-du platform).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const STEP = 1024

export function formatBytes(bytes: null | number): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < STEP) {
    return `${String(bytes)} B`
  }
  let value = bytes
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${String(rounded)} ${UNITS[unit]}`
}

const RELATIVE_UNITS: readonly { label: string; ms: number }[] = [
  { label: 's', ms: 1000 },
  { label: 'm', ms: 60_000 },
  { label: 'h', ms: 3_600_000 },
  { label: 'd', ms: 86_400_000 },
]

// Relative time for lastUsedAt. Returns an em dash for invalid input.
export function formatRelativeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) {
    return '—'
  }

  const deltaMs = Math.max(0, now - then)
  if (deltaMs < 10_000) {
    return 'just now'
  }

  for (const unit of RELATIVE_UNITS) {
    const value = Math.floor(deltaMs / unit.ms)
    if (value < (unit.label === 'd' ? Number.POSITIVE_INFINITY : 60)) {
      return `${String(value)}${unit.label} ago`
    }
  }

  const days = Math.floor(deltaMs / 86_400_000)
  return `${String(days)}d ago`
}
