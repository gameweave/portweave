import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createPanelSecurity } from '../security.ts'

const BOUND_PORT = 7733

const GOOD_HOST = `127.0.0.1:${String(BOUND_PORT)}`
const GOOD_HOST_LOCALHOST = `localhost:${String(BOUND_PORT)}`
const GOOD_ORIGIN = `http://127.0.0.1:${String(BOUND_PORT)}`
const GOOD_ORIGIN_LOCALHOST = `http://localhost:${String(BOUND_PORT)}`

type Headers = Record<string, string | string[] | undefined>

// authorizeMutation only reads req.headers, so a bare object shaped like an
// IncomingMessage is sufficient — no network, no real socket (B-7 test note).
const reqWith = (headers: Headers): IncomingMessage =>
  ({ headers }) as unknown as IncomingMessage

describe('createPanelSecurity', () => {
  it('mints a 64-char hex csrf token', () => {
    const { csrfToken } = createPanelSecurity(BOUND_PORT)

    expect(csrfToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mints a fresh token per call', () => {
    const a = createPanelSecurity(BOUND_PORT)
    const b = createPanelSecurity(BOUND_PORT)

    expect(a.csrfToken).not.toBe(b.csrfToken)
  })
})

describe('authorizeMutation', () => {
  it('allows a good host + origin + token', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST,
        origin: GOOD_ORIGIN,
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(true)
  })

  it('allows localhost host + origin with a good token', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST_LOCALHOST,
        origin: GOOD_ORIGIN_LOCALHOST,
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(true)
  })

  it('allows when origin is absent but host + token are good', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST,
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(true)
  })

  it('rejects a bad host (DNS-rebinding domain)', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: 'evil.example.com',
        origin: GOOD_ORIGIN,
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(false)
  })

  it('rejects a host with the wrong port', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: '127.0.0.1:9999',
        origin: GOOD_ORIGIN,
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(false)
  })

  it('rejects a missing host', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({ 'x-portweave-csrf': security.csrfToken }),
    )

    expect(ok).toBe(false)
  })

  it('rejects a present-but-mismatched (cross-site) origin', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST,
        origin: 'https://evil.example.com',
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(false)
  })

  it('rejects a missing csrf token', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST,
        origin: GOOD_ORIGIN,
      }),
    )

    expect(ok).toBe(false)
  })

  it('rejects a wrong csrf token', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST,
        origin: GOOD_ORIGIN,
        'x-portweave-csrf': 'not-the-token',
      }),
    )

    expect(ok).toBe(false)
  })

  it('rejects an array-valued host header', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: [GOOD_HOST, GOOD_HOST_LOCALHOST],
        origin: GOOD_ORIGIN,
        'x-portweave-csrf': security.csrfToken,
      }),
    )

    expect(ok).toBe(false)
  })

  it('rejects an array-valued csrf header even when it contains the token', () => {
    const security = createPanelSecurity(BOUND_PORT)

    const ok = security.authorizeMutation(
      reqWith({
        host: GOOD_HOST,
        origin: GOOD_ORIGIN,
        'x-portweave-csrf': [security.csrfToken],
      }),
    )

    expect(ok).toBe(false)
  })
})
