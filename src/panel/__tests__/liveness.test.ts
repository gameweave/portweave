import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LIVENESS_TIMEOUT_MS, probePortAlive } from '../liveness.ts'

function listenOnFreePort(
  host: '127.0.0.1' | '::1' = '127.0.0.1',
): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('expected an AddressInfo from listen(0)'))
        return
      }
      resolve({ port: address.port, server })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function findFreePort(): Promise<number> {
  const { port, server } = await listenOnFreePort()
  await closeServer(server)
  return port
}

describe('probePortAlive', () => {
  let openServers: Server[] = []

  afterEach(async () => {
    await Promise.all(openServers.map(closeServer))
    openServers = []
  })

  it('resolves "live" when a listener is bound on the port', async () => {
    const { port, server } = await listenOnFreePort()
    openServers.push(server)

    await expect(probePortAlive(port)).resolves.toBe('live')
  })

  it('resolves "live" when a listener is bound on ::1 only', async () => {
    const { port, server } = await listenOnFreePort('::1')
    openServers.push(server)

    await expect(probePortAlive(port)).resolves.toBe('live')
  })

  it('resolves "not-running" for a free port with no listener', async () => {
    const port = await findFreePort()

    await expect(probePortAlive(port)).resolves.toBe('not-running')
  })

  it('probes many not-running ports in parallel, bounded by ~one timeout', async () => {
    const ports = await Promise.all(
      Array.from({ length: 20 }, () => findFreePort()),
    )

    const start = Date.now()
    const results = await Promise.all(
      ports.map((port) => probePortAlive(port)),
    )
    const elapsed = Date.now() - start

    expect(results).toEqual(ports.map(() => 'not-running'))
    expect(elapsed).toBeLessThan(LIVENESS_TIMEOUT_MS * 2)
  })
})
