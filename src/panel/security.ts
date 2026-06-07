import type { IncomingMessage } from 'node:http'
import { randomBytes } from 'node:crypto'

const CSRF_TOKEN_BYTES = 32

const CSRF_HEADER = 'x-portweave-csrf'

export interface PanelSecurity {
  /** 403-gate for mutating requests: Host + Origin allowlist AND CSRF-header match. */
  authorizeMutation: (req: IncomingMessage) => boolean
  /** crypto.randomBytes(32).toString('hex'), minted once per server. */
  readonly csrfToken: string
}

// A header may arrive as string | string[] | undefined. Only a single string
// value can match an allowlist entry; an array (duplicate header — never
// legitimate here) and an absent header are non-matches, so callers fold them
// into a sentinel rather than treating the array's first element as the value.
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Loopback is NOT a security boundary against a malicious/compromised web page:
 * any page open in the user's browser can fetch/form-POST to the panel (CSRF),
 * and DNS-rebinding can point an attacker domain at 127.0.0.1. So every mutating
 * route is gated by Host + Origin allowlisting AND a per-session CSRF token (B-7).
 */
export function createPanelSecurity(boundPort: number): PanelSecurity {
  const csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex')

  const allowedHosts = new Set([
    `127.0.0.1:${String(boundPort)}`,
    `localhost:${String(boundPort)}`,
  ])
  const allowedOrigins = new Set([
    `http://127.0.0.1:${String(boundPort)}`,
    `http://localhost:${String(boundPort)}`,
  ])

  const authorizeMutation = (req: IncomingMessage): boolean => {
    const host = singleHeader(req.headers.host)
    if (host === undefined || !allowedHosts.has(host)) {
      return false
    }

    // Origin is optional (same-origin navigations and some clients omit it), but
    // a present-and-mismatched Origin is a cross-site request and is rejected.
    const origin = singleHeader(req.headers.origin)
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return false
    }

    const token = singleHeader(req.headers[CSRF_HEADER])
    return token === csrfToken
  }

  return { authorizeMutation, csrfToken }
}
