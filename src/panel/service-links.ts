import type { PanelLink } from './types.ts'
import { isSafeLinkUrl } from './links.ts'

const isHttpLink = (link: PanelLink): boolean => {
  if (!URL.canParse(link.url)) {
    return false
  }
  const { protocol } = new URL(link.url)
  return protocol === 'http:' || protocol === 'https:'
}

// Given a service's already-safe explicit links (its discoveryEnv URLs that
// passed isSafeLinkUrl) and its allocated port, guarantee at least one
// browser-openable link: if no explicit http(s) link exists, append a
// synthesized http://localhost:<port>. An explicit http(s) discovery URL wins
// (it is the configured, intentional preview URL); ws/wss explicit links are
// preserved alongside the synthesized one (they are not browser previews).
export function resolveServiceLinks(
  explicit: readonly PanelLink[],
  port: number,
): readonly PanelLink[] {
  if (explicit.some(isHttpLink)) {
    return explicit
  }

  const synthesized: PanelLink = { envVar: '', url: `http://localhost:${String(port)}` }
  if (Number.isInteger(port) && isSafeLinkUrl(synthesized.url)) {
    return [...explicit, synthesized]
  }

  return explicit
}
