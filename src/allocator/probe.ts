import { connect, createServer } from 'node:net'

const CONNECT_PROBE_TIMEOUT_MS = 250

/**
 * Resolve `true` if binding 127.0.0.1:port fails — something already holds the
 * loopback port. Any error (EADDRINUSE or permissions/sandbox) counts as taken
 * so the allocator defensively skips the port.
 */
function loopbackBindFails(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('listening', () => {
      server.close(() => {
        resolve(false)
      })
    })
    server.once('error', () => {
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Resolve `true` if a TCP connection to 127.0.0.1:port succeeds — i.e. a server
 * is actively listening, including one bound to 0.0.0.0 that a loopback bind did
 * not reveal (see `probePort`). A refused connection or timeout means nothing is
 * answering, so the port is treated as free.
 */
function somethingListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const settle = (result: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(result)
    }
    // Persistent (not `once`) so a post-destroy 'error' never goes unhandled.
    socket.on('connect', () => {
      settle(true)
    })
    socket.on('error', () => {
      settle(false)
    })
    socket.setTimeout(CONNECT_PROBE_TIMEOUT_MS, () => {
      settle(false)
    })
  })
}

/**
 * Probe a single port to determine if it is free or taken.
 *
 * Two steps, because one check is not reliable across platforms:
 *   1. Bind 127.0.0.1 — if that fails, something holds the loopback port → taken.
 *   2. If the bind succeeds the port is loopback-bindable, but on macOS a listener
 *      bound to 0.0.0.0 does NOT block a 127.0.0.1 bind, so step 1 misses it. We
 *      then connect to 127.0.0.1:port; if a server answers, the port is in use
 *      (catches the 0.0.0.0 case) → taken. Otherwise → free.
 *
 * We deliberately never bind 0.0.0.0: that can trigger the macOS firewall prompt,
 * and dev servers only need loopback availability. The connection probe catches
 * 0.0.0.0 listeners without binding to all interfaces.
 */
export async function probePort(port: number): Promise<'free' | 'taken'> {
  if (await loopbackBindFails(port)) {
    return 'taken'
  }
  return (await somethingListening(port)) ? 'taken' : 'free'
}

export type ProbeBlockResult =
  | { allFree: false; firstTakenPort: number }
  | { allFree: true }

/**
 * Probe every port in [start, start + count).
 *
 * Probes sequentially so we can short-circuit on the first taken port and
 * return it for use as the skip-past value in the outer allocator loop.
 */
export async function probeBlock(
  start: number,
  count: number,
): Promise<ProbeBlockResult> {
  for (let port = start; port < start + count; port++) {
    const result = await probePort(port)
    if (result === 'taken') {
      return { allFree: false, firstTakenPort: port }
    }
  }
  return { allFree: true }
}
