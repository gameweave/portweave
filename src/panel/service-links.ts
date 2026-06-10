import type { Config } from '../config/index.ts'
import { referencedServiceNames } from '../env/index.ts'
import type { PanelLink } from './types.ts'
import { isSafeLinkUrl } from './links.ts'

const isHttpLink = (link: PanelLink): boolean => {
  if (!URL.canParse(link.url)) {
    return false
  }
  const { protocol } = new URL(link.url)
  return protocol === 'http:' || protocol === 'https:'
}

// A discoveryEnv URL is a preview link for the service its *template*
// references, not the block that declares it: configs legitimately attach
// entries to the consumer (`mobile.discoveryEnv.EXPO_PUBLIC_API_URL =
// "http://localhost:${api}"`), and buildEnvMap injects every entry globally
// either way, so declaration nesting carries no runtime meaning. Identical
// URLs on one row collapse onto the first envVar encountered in config order
// (decision-log #53).
export function attributeLinks(
  config: Config,
  envMap: Readonly<Record<string, string>>,
): ReadonlyMap<string, readonly PanelLink[]> {
  const serviceNames = new Set(config.services.map((service) => service.name))
  const linksByService = new Map<string, PanelLink[]>()
  for (const service of config.services) {
    for (const [envVar, template] of Object.entries(service.discoveryEnv)) {
      const owner = resolveOwner(template, serviceNames, service.name)
      const url = envMap[envVar]
      if (owner !== null && isSafeLinkUrl(url)) {
        addLink(linksByService, owner, { envVar, url })
      }
    }
  }
  return linksByService
}

// Dedupe at insert: an identical URL keeps the first envVar label it arrived
// under, so consumer aliases (VITE_API_URL / EXPO_PUBLIC_API_URL → same URL)
// render as one link.
function addLink(
  linksByService: Map<string, PanelLink[]>,
  owner: string,
  link: PanelLink,
): void {
  const bucket = linksByService.get(owner) ?? []
  if (!bucket.some((existing) => existing.url === link.url)) {
    bucket.push(link)
  }
  linksByService.set(owner, bucket)
}

// Exactly one referenced service → that service's row; none (literal /
// metadata-only template, e.g. a proxy domain) → the declaring block; two or
// more → a composite value (origin lists etc.) that belongs to no row.
function resolveOwner(
  template: string,
  serviceNames: ReadonlySet<string>,
  declaringService: string,
): null | string {
  const referenced = referencedServiceNames(template, serviceNames)
  if (referenced.length > 1) {
    return null
  }
  return referenced.length === 1 ? referenced[0] : declaringService
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
