import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { TasksFile } from './types.ts'
import { recomputeStats } from './recompute-stats.ts'

export function readTasksFile(path: string): TasksFile {
  if (!existsSync(path)) {
    throw new Error(`Tasks file not found: ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as TasksFile
}

function atomicMoveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest)
  } catch {
    copyFileSync(src, dest)
    unlinkSync(src)
  }
}

export function writeTasksFile(path: string, file: TasksFile): void {
  recomputeStats(file)
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(
    dir,
    `.tasks-${String(process.pid)}-${String(Date.now())}.tmp`,
  )
  writeFileSync(tmpPath, JSON.stringify(file, null, 2) + '\n', 'utf8')
  atomicMoveFile(tmpPath, path)
}

export function createEmptyTasksFile(
  source: string,
  description: string,
): TasksFile {
  return {
    groups: {},
    metadata: {
      created: new Date().toISOString(),
      description,
      source,
      stats: {
        complete: 0,
        failed: 0,
        in_progress: 0,
        needs_review: 0,
        needs_rework: 0,
        todo: 0,
      },
      totalTasks: 0,
    },
    tasks: [],
  }
}
