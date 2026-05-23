import { readFile } from 'node:fs/promises'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import {
  type AllocationKey,
  REGISTRY_VERSION,
  type RegistryEntry,
  type RegistryFile,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const parsed = Date.parse(value)
  return !Number.isNaN(parsed)
}

function parseKey(raw: unknown): AllocationKey | null {
  if (!isRecord(raw)) {
    return null
  }
  const { gitCommonDir, namespace, worktreeRoot } = raw
  if (typeof worktreeRoot !== 'string' || typeof namespace !== 'string') {
    return null
  }
  if (gitCommonDir !== null && typeof gitCommonDir !== 'string') {
    return null
  }
  return { gitCommonDir, namespace, offsetOverride: null, worktreeRoot }
}

function parsePorts(raw: unknown): null | Readonly<Record<string, number>> {
  if (!isRecord(raw)) {
    return null
  }
  const ports: Record<string, number> = {}
  for (const [name, port] of Object.entries(raw)) {
    if (typeof port !== 'number' || !Number.isInteger(port)) {
      return null
    }
    ports[name] = port
  }
  return ports
}

function parseEntry(raw: unknown): null | RegistryEntry {
  if (!isRecord(raw)) {
    return null
  }
  const key = parseKey(raw.key)
  if (key === null) {
    return null
  }
  const ports = parsePorts(raw.ports)
  if (ports === null) {
    return null
  }
  if (!isIsoDateString(raw.lastUsedAt)) {
    return null
  }
  if (typeof raw.namespace !== 'string') {
    return null
  }
  return {
    key,
    lastUsedAt: raw.lastUsedAt,
    namespace: raw.namespace,
    ports,
  }
}

function parseRegistry(raw: unknown): null | RegistryFile {
  if (!isRecord(raw)) {
    return null
  }
  if (raw.version !== REGISTRY_VERSION) {
    return null
  }
  if (!Array.isArray(raw.entries)) {
    return null
  }
  const entries: RegistryEntry[] = []
  for (const item of raw.entries) {
    const entry = parseEntry(item)
    if (entry === null) {
      return null
    }
    entries.push(entry)
  }
  return { entries, version: REGISTRY_VERSION }
}

export async function loadRegistryFile(
  path: string,
): Promise<Result<RegistryFile, PortweaveError>> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (caught: unknown) {
    if (
      isRecord(caught) &&
      typeof caught.code === 'string' &&
      caught.code === 'ENOENT'
    ) {
      return ok({ entries: [], version: REGISTRY_VERSION })
    }
    const message = caught instanceof Error ? caught.message : 'unknown error'
    return err(
      new PortweaveError(
        PW_ERROR_CODES.REGISTRY_CORRUPT,
        `failed to read registry file at ${path}: ${message}`,
      ),
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (caught: unknown) {
    const message = caught instanceof Error ? caught.message : 'invalid JSON'
    return err(
      new PortweaveError(
        PW_ERROR_CODES.REGISTRY_CORRUPT,
        `registry file at ${path} is not valid JSON: ${message}`,
      ),
    )
  }

  const file = parseRegistry(parsed)
  if (file === null) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.REGISTRY_CORRUPT,
        `registry file at ${path} failed schema validation`,
      ),
    )
  }
  return ok(file)
}

export function serializeRegistry(file: RegistryFile): string {
  const sorted = [...file.entries].sort((a, b) => {
    if (a.key.worktreeRoot !== b.key.worktreeRoot) {
      return a.key.worktreeRoot < b.key.worktreeRoot ? -1 : 1
    }
    return a.key.namespace < b.key.namespace ? -1 : 1
  })
  const normalized = sorted.map((entry) => ({
    key: {
      gitCommonDir: entry.key.gitCommonDir,
      namespace: entry.key.namespace,
      worktreeRoot: entry.key.worktreeRoot,
    },
    lastUsedAt: entry.lastUsedAt,
    namespace: entry.namespace,
    ports: Object.fromEntries(
      Object.entries(entry.ports).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  }))
  return `${JSON.stringify({ entries: normalized, version: file.version }, null, 2)}\n`
}
