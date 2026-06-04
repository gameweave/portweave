import type { PanelLink, PanelService } from '../types.ts'

import { LivenessBadge } from './LivenessBadge.tsx'

// Defense in depth at the render sink: even though enrich.ts already filters
// unsafe schemes, only render a link as <a href> when its URL parses and its
// scheme is browser-safe. A `javascript:`/`data:` URL would otherwise be a
// script-execution sink. Anything outside the allowlist renders as plain text.
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])
const isSafeLinkUrl = (value: string): boolean =>
  URL.canParse(value) && SAFE_LINK_SCHEMES.has(new URL(value).protocol)

export function ServiceRow({ service }: { service: PanelService }) {
  const safe: PanelLink[] = service.links.filter((link) =>
    isSafeLinkUrl(link.url),
  )
  const unsafe: PanelLink[] = service.links.filter(
    (link) => !isSafeLinkUrl(link.url),
  )

  return (
    <div className="service-row">
      <span className="service-name">{service.name}</span>
      {service.envVar ? (
        <span className="service-envvar">{service.envVar}</span>
      ) : null}
      <LivenessBadge status={service.status} />
      {safe.length > 0 ? (
        <span className="service-links">
          {safe.map((link) => (
            <a
              key={link.envVar}
              className="service-link"
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={`${link.envVar} → ${link.url}`}
            >
              {link.url}
            </a>
          ))}
        </span>
      ) : (
        <span className="port-chip" title="no preview link — raw port">
          :{service.port}
        </span>
      )}
      {unsafe.map((link) => (
        <span
          key={link.envVar}
          className="service-link-unsafe"
          title={`${link.envVar} → ${link.url} (unsafe scheme — not linked)`}
        >
          {link.url}
        </span>
      ))}
    </div>
  )
}
