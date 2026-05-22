import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyWorktreeEnv } from './apply-worktree-env.ts'
import { computePorts, type WorktreePorts } from './worktree-ports.ts'
import { resolveWorktreeContext } from './worktree-context.ts'

const DECIMAL_RADIX = 10

const DOTENV_PORT_KEYS = [
  'API_PORT',
  'AUTH_API_PORT',
  'DYNAMODB_ADMIN_PORT',
  'DYNAMODB_ENDPOINT',
  'DYNAMODB_PORT',
  'KINESIS_ENDPOINT',
  'KINESIS_PORT',
  'KINESIS_TLS_PORT',
  'SES_ENDPOINT',
  'SES_LOCAL_PORT',
  'VITE_API_PORT',
  'VITE_AUTH_PORT',
  'VITE_PORT',
  'VITE_WS_PORT',
  'WEBSOCKET_ENDPOINT',
  'WS_PORT',
] as const

export interface E2ePortEnv {
  namespace: string
  ports: WorktreePorts
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
  seedIfMissing('VITE_AUTH_PORT', process.env.AUTH_API_PORT)
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

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`${key} must be configured before running e2e`)
  }
  return value
}

function parsePort(key: string): number {
  const value = requiredEnv(key)
  const port = Number.parseInt(value, DECIMAL_RADIX)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be an integer in [1, 65535]`)
  }
  return port
}

function effectivePorts(): WorktreePorts {
  return {
    api: parsePort('API_PORT'),
    app: parsePort('VITE_PORT'),
    authApi: parsePort('AUTH_API_PORT'),
    dynamodb: parsePort('DYNAMODB_PORT'),
    dynamodbAdmin: parsePort('DYNAMODB_ADMIN_PORT'),
    kinesis: parsePort('KINESIS_PORT'),
    kinesisTls: parsePort('KINESIS_TLS_PORT'),
    ses: parsePort('SES_LOCAL_PORT'),
    ws: parsePort('WS_PORT'),
  }
}

function configureBrowserUrls(): void {
  const apiPort = requiredEnv('API_PORT')
  const authApiPort = requiredEnv('AUTH_API_PORT')
  const viteApiPort = requiredEnv('VITE_API_PORT')
  const viteAuthPort = requiredEnv('VITE_AUTH_PORT')
  const wsPort = requiredEnv('VITE_WS_PORT')
  process.env.VITE_API_URL ??= `http://localhost:${viteApiPort}`
  process.env.VITE_AUTH_URL ??= `http://localhost:${viteAuthPort}`
  process.env.VITE_WS_URL ??= `ws://localhost:${wsPort}`
  process.env.E2E_API_ORIGIN ??= `http://localhost:${apiPort}`
  process.env.E2E_AUTH_ORIGIN ??= `http://localhost:${authApiPort}`
}

export function configureE2ePortEnv(cwd = process.cwd()): E2ePortEnv {
  const { namespace, offset } = resolveWorktreeContext(cwd)
  const computedPorts = computePorts(offset)
  seedEnvFromDotenv(readRootEnv(cwd))
  seedDerivedEnvFromConfiguredPorts()
  process.env.DYNAMODB_ADMIN_PORT ??= String(computedPorts.dynamodbAdmin)
  applyWorktreeEnv(computedPorts, namespace, offset)
  configureBrowserUrls()
  return { namespace, ports: effectivePorts() }
}
