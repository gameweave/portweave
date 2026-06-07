import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { listenOnFreePort, PANEL_PORT_ATTEMPTS } from '../listen.ts'

const HOST = '127.0.0.1'

const open: Server[] = []

function track(server: Server): Server {
  open.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(
    open.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

// Bind :0 to learn a (very likely still) free port number, then release it.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.once('listening', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('expected an AddressInfo'))
        return
      }
      const { port } = address
      probe.close(() => {
        resolve(port)
      })
    })
    probe.listen(0, HOST)
  })
}

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.once('listening', () => {
      resolve(track(server))
    })
    server.listen(port, HOST)
  })
}

describe('listenOnFreePort', () => {
  it('binds the requested port when it is free (one attempt)', async () => {
    const port = await freePort()
    const result = await listenOnFreePort(track(createServer()), port, HOST)
    expect(result.boundPort).toBe(port)
    expect(result.attempts).toBe(1)
  })

  it('skips an in-use port and falls forward to the next free one', async () => {
    const port = await freePort()
    await occupy(port)
    const result = await listenOnFreePort(track(createServer()), port, HOST, 5)
    expect(result.boundPort).toBeGreaterThan(port)
    expect(result.attempts).toBeGreaterThanOrEqual(2)
  })

  it('rejects with ALL_PORTS_IN_USE when every candidate is taken', async () => {
    const port = await freePort()
    await occupy(port)
    // attempts: 1 → only the (taken) requested port is tried.
    await expect(
      listenOnFreePort(track(createServer()), port, HOST, 1),
    ).rejects.toMatchObject({ code: 'ALL_PORTS_IN_USE' })
  })

  it('exposes a positive default attempt budget', () => {
    expect(PANEL_PORT_ATTEMPTS).toBeGreaterThan(0)
  })
})
