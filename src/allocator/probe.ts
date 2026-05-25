import { createServer } from 'node:net'

/**
 * Probe a single port on 127.0.0.1 to determine if it is free or taken.
 *
 * Binds to 127.0.0.1 explicitly — we only care about loopback availability.
 * Binding to 0.0.0.0 would falsely flag ports as free when an
 * interface-specific listener exists on a different address.
 */
export function probePort(port: number): Promise<'free' | 'taken'> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('listening', () => {
      server.close(() => {
        resolve('free')
      })
    })
    // Any error (EADDRINUSE or permissions/sandbox issues) means we cannot
    // bind — treat as taken so the allocator skips this port defensively.
    server.once('error', () => {
      resolve('taken')
    })
    server.listen(port, '127.0.0.1')
  })
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
