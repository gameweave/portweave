import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type WorktreePorts } from './worktree-ports.ts'

const DOTENV_PORT_KEYS = [
  'API_PORT',
  'DYNAMODB_ADMIN_PORT',
  'DYNAMODB_ENDPOINT',
  'DYNAMODB_PORT',
  'KINESIS_ENDPOINT',
  'KINESIS_PORT',
  'SES_ENDPOINT',
  'SES_LOCAL_PORT',
  'VITE_API_PORT',
  'VITE_PORT',
  'VITE_WS_PORT',
  'WEBSOCKET_ENDPOINT',
  'WS_PORT',
] as const

function setIfUnset(key: string, value: string): void {
  process.env[key] ??= value
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null
  }

  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex <= 0) {
    return null
  }

  const key = trimmed.slice(0, separatorIndex).trim()
  const value = stripOptionalQuotes(trimmed.slice(separatorIndex + 1).trim())
  return [key, value]
}

function readRootEnv(cwd: string): Partial<Record<string, string>> {
  const path = resolve(cwd, '.env')
  if (!existsSync(path)) {
    return {}
  }

  const values: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const entry = parseEnvLine(line)
    if (entry === null) {
      continue
    }
    const [key, value] = entry
    values[key] = value
  }
  return values
}

function seedEnvFromDotenv(fileEnv: Partial<Record<string, string>>): void {
  for (const key of DOTENV_PORT_KEYS) {
    const value = fileEnv[key]
    if (process.env[key] === undefined && value !== undefined && value !== '') {
      process.env[key] = value
    }
  }
}

function seedIfMissing(key: string, value: string | undefined): void {
  if (process.env[key] === undefined && value !== undefined && value !== '') {
    process.env[key] = value
  }
}

function seedDerivedEnvFromConfiguredPorts(): void {
  seedIfMissing('VITE_API_PORT', process.env.API_PORT)
  seedIfMissing('VITE_WS_PORT', process.env.WS_PORT)
  seedIfMissing(
    'DYNAMODB_ENDPOINT',
    process.env.DYNAMODB_PORT === undefined
      ? undefined
      : `http://localhost:${process.env.DYNAMODB_PORT}`,
  )
  seedIfMissing(
    'KINESIS_ENDPOINT',
    process.env.KINESIS_PORT === undefined
      ? undefined
      : `http://localhost:${process.env.KINESIS_PORT}`,
  )
  seedIfMissing(
    'SES_ENDPOINT',
    process.env.SES_LOCAL_PORT === undefined
      ? undefined
      : `http://localhost:${process.env.SES_LOCAL_PORT}`,
  )
  seedIfMissing(
    'WEBSOCKET_ENDPOINT',
    process.env.WS_PORT === undefined
      ? undefined
      : `http://localhost:${process.env.WS_PORT}`,
  )
}

export function seedWorktreeEnvFromDotenv(cwd = process.cwd()): void {
  seedEnvFromDotenv(readRootEnv(cwd))
  seedDerivedEnvFromConfiguredPorts()
}

function readPortFromEnv(key: string, fallback: number): number {
  const value = process.env[key]
  if (value === undefined || value === '') {
    return fallback
  }
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be an integer in [1, 65535]`)
  }
  return port
}

export function resolveEffectiveWorktreePorts(
  fallback: WorktreePorts,
): WorktreePorts {
  return {
    api: readPortFromEnv('API_PORT', fallback.api),
    app: readPortFromEnv('VITE_PORT', fallback.app),
    authApi: readPortFromEnv('AUTH_API_PORT', fallback.authApi),
    dynamodb: readPortFromEnv('DYNAMODB_PORT', fallback.dynamodb),
    dynamodbAdmin: readPortFromEnv(
      'DYNAMODB_ADMIN_PORT',
      fallback.dynamodbAdmin,
    ),
    kinesis: readPortFromEnv('KINESIS_PORT', fallback.kinesis),
    kinesisTls: readPortFromEnv('KINESIS_TLS_PORT', fallback.kinesisTls),
    ses: readPortFromEnv('SES_LOCAL_PORT', fallback.ses),
    ws: readPortFromEnv('WS_PORT', fallback.ws),
  }
}

export function applyWorktreeEnv(
  ports: WorktreePorts,
  namespace: string,
  offset: number,
): void {
  setIfUnset('GAMEWEAVE_PM2_NAMESPACE', namespace)
  setIfUnset('GAMEWEAVE_WORKTREE_OFFSET', String(offset))
  setIfUnset('API_PORT', String(ports.api))
  setIfUnset('VITE_API_PORT', String(ports.api))
  setIfUnset('WS_PORT', String(ports.ws))
  setIfUnset('VITE_WS_PORT', String(ports.ws))
  setIfUnset('VITE_PORT', String(ports.app))
  setIfUnset('AUTH_API_PORT', String(ports.authApi))
  setIfUnset('VITE_AUTH_PORT', String(ports.authApi))
  setIfUnset('DYNAMODB_PORT', String(ports.dynamodb))
  setIfUnset('DYNAMODB_ENDPOINT', `http://localhost:${String(ports.dynamodb)}`)
  setIfUnset('KINESIS_PORT', String(ports.kinesis))
  setIfUnset('KINESIS_TLS_PORT', String(ports.kinesisTls))
  setIfUnset('KINESIS_ENDPOINT', `http://localhost:${String(ports.kinesis)}`)
  setIfUnset('SES_LOCAL_PORT', String(ports.ses))
  setIfUnset('SES_ENDPOINT', `http://localhost:${String(ports.ses)}`)
  setIfUnset('WEBSOCKET_ENDPOINT', `http://localhost:${String(ports.ws)}`)
}
