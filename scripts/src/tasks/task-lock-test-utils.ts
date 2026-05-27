import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockFilePayload } from './task-lock.ts'

const FILE_ENCODING = 'utf8'
export const TASKS_JSON = 'tasks.json'
export const STALE_MS = 60_000

export function createUniqueTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cleanupDir(dir: string): void {
  if (dir && existsSync(dir)) {
    rmSync(dir, { force: true, recursive: true })
  }
}

export function lockPathFor(tasksPath: string): string {
  return `${tasksPath}.lock`
}

export function writeEmptyTasksFile(testDir: string): string {
  const tasksPath = join(testDir, TASKS_JSON)
  writeFileSync(tasksPath, '{}', FILE_ENCODING)
  return tasksPath
}

export function writeLockPayload(
  tasksPath: string,
  payload: LockFilePayload,
): void {
  writeFileSync(
    lockPathFor(tasksPath),
    `${JSON.stringify(payload)}\n`,
    FILE_ENCODING,
  )
}
