import { connect } from 'node:net'
import type { PanelLivenessStatus } from './types.ts'

export const LIVENESS_TIMEOUT_MS = 250 as const

const STATUS_LIVE = 'live' satisfies PanelLivenessStatus
const STATUS_NOT_RUNNING = 'not-running' satisfies PanelLivenessStatus

const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const

/**
 * Attempt a TCP connect to one loopback host. Resolves true on connect,
 * false on error or timeout.
 */
function probeHost(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })

    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

/**
 * Probe a single port on loopback to determine if something is listening.
 *
 * The inverse of the allocator's bind-test probe: instead of "can I bind?"
 * ( = is it free?), the panel asks "can I connect?" ( = is something there?).
 *
 * Probes both IPv4 (`127.0.0.1`) and IPv6 (`::1`) in parallel. Dev servers
 * that bind `localhost` often listen on `::1` only on macOS, so an IPv4-only
 * probe would falsely report not-running.
 *
 * A slow/unresponsive listener that does not complete the handshake within
 * `timeoutMs` reads as 'not-running': the semantics are "something answered a
 * TCP handshake quickly," not "healthy".
 */
export function probePortAlive(
  port: number,
  timeoutMs: number = LIVENESS_TIMEOUT_MS,
): Promise<PanelLivenessStatus> {
  return Promise.all(
    LOOPBACK_HOSTS.map((host) => probeHost(host, port, timeoutMs)),
  ).then((results) =>
    results.some(Boolean) ? STATUS_LIVE : STATUS_NOT_RUNNING,
  )
}
