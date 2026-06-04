import { connect } from 'node:net'
import type { PanelLivenessStatus } from './types.ts'

export const LIVENESS_TIMEOUT_MS = 250 as const

const STATUS_LIVE = 'live' satisfies PanelLivenessStatus
const STATUS_NOT_RUNNING = 'not-running' satisfies PanelLivenessStatus

/**
 * Probe a single port on 127.0.0.1 to determine if something is listening.
 *
 * The inverse of the allocator's bind-test probe: instead of "can I bind?"
 * ( = is it free?), the panel asks "can I connect?" ( = is something there?).
 *
 * Binds 127.0.0.1 explicitly for the same reason the allocator probe does — a
 * service bound to a specific interface should be probed on loopback, and we
 * must not accidentally probe a remote host.
 *
 * A slow/unresponsive listener that does not complete the handshake within
 * `timeoutMs` reads as 'not-running': the semantics are "something answered a
 * TCP handshake quickly," not "healthy".
 */
export function probePortAlive(
  port: number,
  timeoutMs: number = LIVENESS_TIMEOUT_MS,
): Promise<PanelLivenessStatus> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })

    const timer = setTimeout(() => {
      socket.destroy()
      resolve(STATUS_NOT_RUNNING)
    }, timeoutMs)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(STATUS_LIVE)
    })

    // Any connect error (ECONNREFUSED etc.) means nothing is listening.
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(STATUS_NOT_RUNNING)
    })
  })
}
