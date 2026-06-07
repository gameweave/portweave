import type { Server } from 'node:http'

// How many sequential ports to try (start, start+1, …) before giving up.
export const PANEL_PORT_ATTEMPTS = 20

const MAX_PORT = 65535

export interface ListenResult {
  readonly attempts: number
  readonly boundPort: number
}

/**
 * Listen on the first free port in `[startPort, startPort + attempts)`, skipping
 * any port already in use (`EADDRINUSE`) and trying the next. Resolves with the
 * bound port. Rejects with the underlying error on a non-`EADDRINUSE` listen
 * failure, or an `Error` whose `.code` is `'ALL_PORTS_IN_USE'` when every
 * candidate (capped at 65535) is taken.
 *
 * The same server is re-used across attempts: a listen that fails with
 * `EADDRINUSE` leaves the server usable for another `listen()` call.
 */
export async function listenOnFreePort(
  server: Server,
  startPort: number,
  host: string,
  attempts: number = PANEL_PORT_ATTEMPTS,
): Promise<ListenResult> {
  let lastTried = startPort
  for (let offset = 0; offset < attempts; offset++) {
    const candidate = startPort + offset
    if (candidate > MAX_PORT) {
      break
    }
    lastTried = candidate
     
    const bound = await tryListen(server, candidate, host)
    if (bound) {
      return { attempts: offset + 1, boundPort: boundPortOf(server, candidate) }
    }
  }
  const error = new Error(
    `no free port in ${String(startPort)}–${String(lastTried)}`,
  ) as NodeJS.ErrnoException
  error.code = 'ALL_PORTS_IN_USE'
  throw error
}

function boundPortOf(server: Server, fallback: number): number {
  const address = server.address()
  return address !== null && typeof address !== 'string'
    ? address.port
    : fallback
}

// Resolve true when the server binds `port`, false on EADDRINUSE (caller tries
// the next port), and reject on any other listen error. Listeners are paired
// with `.once` and the sibling removed on settle, so attempts can re-use one
// server without leaking handlers.
function tryListen(
  server: Server,
  port: number,
  host: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening)
      if (error.code === 'EADDRINUSE') {
        resolve(false)
        return
      }
      reject(error)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}
