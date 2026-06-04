import { createServer, type Server } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Command } from 'commander'
import { PW_ERROR_CODES } from '../../errors.ts'
import { registerPanelCommand, runPanel } from '../panel.ts'
import { makeWritable } from './_helpers.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Boot a throwaway loopback listener on an ephemeral port and report the port.
function bindThrowaway(): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('test setup: expected an AddressInfo'))
        return
      }
      resolve({ port: address.port, server })
    })
    server.listen(0, '127.0.0.1')
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve()
    })
  })
}

// Poll a captured-stderr accessor until the panel announce line appears, then
// return the bound port parsed out of it.
async function waitForAnnouncedPort(read: () => string): Promise<number> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const match = /panel: http:\/\/127\.0\.0\.1:(\d+)\//.exec(read())
    if (match !== null) {
      return Number(match[1])
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for the panel announce line')
}

// Run runPanel for a fail-fast (non-blocking) port and return the exit code and
// captured stderr. Used by the exit-1 cases (port-in-use, invalid --port) that
// resolve immediately rather than holding the server open.
async function runPanelCapturing(
  port: number,
): Promise<{ exitCode: number; stderr: string }> {
  const out = makeWritable()
  const serr = makeWritable()
  const result = await runPanel({
    env,
    port,
    stderr: serr.stream,
    stdout: out.stream,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error('expected runPanel to resolve ok')
  }
  return { exitCode: result.value.exitCode, stderr: serr.value() }
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let configDir: string
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-panel-cfg-'))
  env = { XDG_CONFIG_HOME: configDir }
})

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true })
})

// ---------------------------------------------------------------------------
// Test 19: Clean shutdown via injected AbortController signal
// ---------------------------------------------------------------------------
describe('runPanel — clean shutdown via signal', () => {
  it('resolves ok({ exitCode: 0 }) and frees the port after abort', async () => {
    const ac = new AbortController()
    const out = makeWritable()
    const serr = makeWritable()

    const pending = runPanel({
      env,
      port: 0,
      signal: ac.signal,
      stderr: serr.stream,
      stdout: out.stream,
    })

    const boundPort = await waitForAnnouncedPort(serr.value)
    expect(serr.value()).toContain('press Ctrl-C to stop')

    ac.abort()
    const result = await pending

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.exitCode).toBe(0)
    }

    // Port is freed: a fresh bind on the same port now succeeds.
    const rebind = await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once('error', () => {
        resolve(false)
      })
      server.once('listening', () => {
        server.close(() => {
          resolve(true)
        })
      })
      server.listen(boundPort, '127.0.0.1')
    })
    expect(rebind).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 20: Port-in-use → exit 1
// ---------------------------------------------------------------------------
describe('runPanel — port in use', () => {
  it('exits 1, stderr names the port, carries CLI_PANEL_PORT_IN_USE', async () => {
    const { port, server } = await bindThrowaway()
    try {
      const { exitCode, stderr } = await runPanelCapturing(port)
      expect(exitCode).toBe(1)
      expect(stderr).toContain(String(port))
      expect(stderr).toContain(PW_ERROR_CODES.CLI_PANEL_PORT_IN_USE)
    } finally {
      await closeServer(server)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 21: Invalid --port
// ---------------------------------------------------------------------------
describe('runPanel — invalid --port', () => {
  it('exits 1 with CLI_INVALID_FLAGS for a negative port', async () => {
    const { exitCode, stderr } = await runPanelCapturing(-1)
    expect(exitCode).toBe(1)
    expect(stderr).toContain(PW_ERROR_CODES.CLI_INVALID_FLAGS)
  })

  it('exits 1 with CLI_INVALID_FLAGS for a NaN port', async () => {
    const { exitCode, stderr } = await runPanelCapturing(Number.NaN)
    expect(exitCode).toBe(1)
    expect(stderr).toContain(PW_ERROR_CODES.CLI_INVALID_FLAGS)
  })
})

// ---------------------------------------------------------------------------
// Test 22: registerPanelCommand registration
// ---------------------------------------------------------------------------
describe('registerPanelCommand', () => {
  it('registers the panel command and a --port option', () => {
    expect(typeof registerPanelCommand).toBe('function')

    const commands: string[] = []
    const options: string[] = []
    const stub = {
      action: () => stub,
      command: (name: string) => {
        commands.push(name)
        return stub
      },
      description: () => stub,
      option: (flags: string) => {
        options.push(flags)
        return stub
      },
    }
    registerPanelCommand(stub as unknown as Command)

    expect(commands).toContain('panel')
    expect(options.some((flag) => flag.includes('--port'))).toBe(true)
  })
})
