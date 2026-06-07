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
