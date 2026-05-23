import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { loadConfig } from '../loader.ts'

const VALID_CONFIG_JSON = `{
  "$schema": "https://portweave.dev/schema/v1.json",
  "services": {
    "api": {
      "envVar": "API_PORT",
      "preferred": 3001,
      "discoveryEnv": {
        "VITE_API_URL": "http://localhost:\${api}",
        "E2E_API_ORIGIN": "http://localhost:\${api}"
      }
    },
    "ws": {
      "envVar": "WS_PORT",
      "preferred": 3002,
      "discoveryEnv": {
        "VITE_WS_URL": "ws://localhost:\${ws}",
        "WEBSOCKET_ENDPOINT": "http://localhost:\${ws}"
      }
    },
    "vite": {
      "envVar": "VITE_PORT",
      "preferred": 5173
    },
    "dynamodb": {
      "group": "dynamodb",
      "envVar": "DYNAMODB_PORT",
      "preferred": 8000
    },
    "dynamodb-admin": {
      "group": "dynamodb",
      "envVar": "DYNAMODB_ADMIN_PORT",
      "preferred": 8001
    },
    "kinesis": {
      "group": "kinesis",
      "envVar": "KINESIS_PORT",
      "preferred": 4568
    },
    "kinesis-tls": {
      "group": "kinesis",
      "envVar": "KINESIS_TLS_PORT",
      "preferred": 4567
    },
    "ses": {
      "envVar": "SES_LOCAL_PORT",
      "preferred": 8005
    }
  }
}`

const DEFAULT_CONFIG_NAME = 'portweave.config.json'

interface TempState {
  dirtyFiles: string[]
  tempDir: string
}

function makeTempState(): TempState {
  return { dirtyFiles: [], tempDir: '' }
}

function installTempLifecycle(state: TempState): void {
  beforeEach(async () => {
    state.tempDir = await mkdtemp(join(tmpdir(), 'portweave-loader-'))
  })

  afterEach(async () => {
    for (const file of state.dirtyFiles.splice(0)) {
      try {
        await chmod(file, 0o600)
      } catch {
        // pw-allow-swallow: best-effort restore so rm can clean the tempdir
      }
    }
    await rm(state.tempDir, { force: true, recursive: true })
  })
}

describe('loadConfig — happy path', () => {
  const state = makeTempState()
  installTempLifecycle(state)

  it('loads the DESIGN.md Appendix A sample successfully', async () => {
    await writeFile(join(state.tempDir, DEFAULT_CONFIG_NAME), VALID_CONFIG_JSON)
    const result = await loadConfig(state.tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services).toHaveLength(8)
    expect(result.value.services.map((s) => s.name)).toStrictEqual([
      'api',
      'ws',
      'vite',
      'dynamodb',
      'dynamodb-admin',
      'kinesis',
      'kinesis-tls',
      'ses',
    ])
    const byName = new Map(result.value.services.map((s) => [s.name, s]))
    expect(byName.get('api')?.envVar).toBe('API_PORT')
    expect(byName.get('api')?.preferred).toBe(3001)
    expect(byName.get('api')?.discoveryEnv).toStrictEqual({
      E2E_API_ORIGIN: 'http://localhost:${api}',
      VITE_API_URL: 'http://localhost:${api}',
    })
    expect(byName.get('vite')?.discoveryEnv).toStrictEqual({})
    expect(result.value.groups).toStrictEqual({
      dynamodb: ['dynamodb', 'dynamodb-admin'],
      kinesis: ['kinesis', 'kinesis-tls'],
    })
    expect(result.value.source).toBe('file')
    expect(result.value.sourcePath).toBe(
      join(state.tempDir, DEFAULT_CONFIG_NAME),
    )
  })

  it('preserves discoveryEnv template placeholders round-trip', async () => {
    const payload = JSON.stringify({
      services: {
        api: {
          discoveryEnv: { TARGET: 'http://localhost:${api}/v1' },
          envVar: 'API_PORT',
        },
      },
    })
    await writeFile(join(state.tempDir, DEFAULT_CONFIG_NAME), payload)
    const result = await loadConfig(state.tempDir)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.services[0]?.discoveryEnv.TARGET).toBe(
      'http://localhost:${api}/v1',
    )
  })
})

describe('loadConfig — failure paths', () => {
  const state = makeTempState()
  installTempLifecycle(state)

  it('returns CONFIG_MISSING when no portweave.config.json is present', async () => {
    const result = await loadConfig(state.tempDir)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_MISSING)
    expect(result.error.message).toContain(
      join(state.tempDir, DEFAULT_CONFIG_NAME),
    )
  })

  it('returns CONFIG_INVALID for malformed JSON', async () => {
    await writeFile(join(state.tempDir, DEFAULT_CONFIG_NAME), '{ "services": ')
    const result = await loadConfig(state.tempDir)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_INVALID)
  })

  it('returns CONFIG_INVALID for schema-invalid JSON', async () => {
    const payload = JSON.stringify({
      bogusToplevel: true,
      services: { api: { envVar: 'API_PORT' } },
    })
    await writeFile(join(state.tempDir, DEFAULT_CONFIG_NAME), payload)
    const result = await loadConfig(state.tempDir)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_INVALID)
    expect(result.error.message).toContain('bogusToplevel')
  })

  it('returns CONFIG_INVALID when the file is unreadable', async () => {
    if (process.platform === 'win32') {
      return
    }
    const target = join(state.tempDir, DEFAULT_CONFIG_NAME)
    await writeFile(target, VALID_CONFIG_JSON)
    await chmod(target, 0o000)
    state.dirtyFiles.push(target)
    const result = await loadConfig(state.tempDir)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe(PW_ERROR_CODES.CONFIG_INVALID)
  })
})

describe('loadConfig — configPath resolution', () => {
  const state = makeTempState()
  installTempLifecycle(state)

  it('honors an explicit relative configPath under cwd', async () => {
    const custom = 'custom.json'
    await writeFile(join(state.tempDir, custom), VALID_CONFIG_JSON)
    const result = await loadConfig(state.tempDir, { configPath: custom })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.sourcePath).toBe(join(state.tempDir, custom))
  })

  it('resolves a ./-prefixed relative configPath', async () => {
    await writeFile(join(state.tempDir, 'config.json'), VALID_CONFIG_JSON)
    const result = await loadConfig(state.tempDir, {
      configPath: './config.json',
    })
    expect(result.ok).toBe(true)
  })

  it('honors an absolute configPath regardless of cwd', async () => {
    const abs = join(state.tempDir, 'abs.json')
    await writeFile(abs, VALID_CONFIG_JSON)
    const result = await loadConfig('/var/empty', { configPath: abs })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.sourcePath).toBe(abs)
  })
})
