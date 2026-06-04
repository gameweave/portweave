import type { PanelSnapshot } from './types.ts'

// Relative URL works because the app is served same-origin by the panel server
// (and proxied to the backend in dev). See 02-frontend.md "Data flow".
export async function fetchSnapshot(): Promise<PanelSnapshot> {
  const res = await fetch('/api/allocations')
  if (!res.ok) {
    throw new Error(`Request failed: ${String(res.status)} ${res.statusText}`)
  }
  return (await res.json()) as PanelSnapshot
}
