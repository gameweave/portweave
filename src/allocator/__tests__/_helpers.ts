import { createServer, type Server } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../config/index.ts'
import type { AllocationKey } from '../../registry/types.ts'

export interface ServiceInput {
  envVar: string
  group?: string
  name: string
}

export function makeAllocatorConfig(services: ServiceInput[]): Config {
  return {
    groups: {},
    services: services.map((s) => ({
      discoveryEnv: {},
      envVar: s.envVar,
      ...(s.group !== undefined ? { group: s.group } : {}),
      name: s.name,
    })),
    source: 'anonymous',
  }
}

export function makeAllocationKey(
  worktreeRoot: string,
  overrides: Partial<AllocationKey> = {},
): AllocationKey {
  return {
    gitCommonDir: null,
    namespace: 'test-main',
    offsetOverride: null,
    worktreeRoot,
    ...overrides,
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

export function bindServerOnPort(
  port: number,
): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({ close: () => closeServer(server) })
    })
  })
}

export interface TempDirs {
  configDir: string
  worktreeDirs: string[]
}

export async function makeTempDirs(): Promise<TempDirs> {
  const configDir = await mkdtemp(join(tmpdir(), 'pw-alloc-test-'))
  return { configDir, worktreeDirs: [] }
}

export async function cleanupTempDirs(dirs: TempDirs): Promise<void> {
  await rm(dirs.configDir, { force: true, recursive: true })
  for (const dir of dirs.worktreeDirs) {
    await rm(dir, { force: true, recursive: true })
  }
}

export async function addWorktreeDir(dirs: TempDirs): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pw-wt-'))
  dirs.worktreeDirs.push(dir)
  return dir
}
