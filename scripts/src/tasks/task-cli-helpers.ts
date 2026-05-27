import { exit } from 'node:process'
import type { Task, TasksFile } from './types.ts'
import { TASK_STATUSES } from './types.ts'
import { resolveTasksPath } from './resolve-session.ts'
import { readTasksFile } from './task-io.ts'
import { LockAcquisitionError, withTasksFileLock } from './task-lock.ts'
import type { LockOptions } from './task-lock.ts'

class TasksFileReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TasksFileReadError'
  }
}

function readTasksFileOrThrow(tasksPath: string): TasksFile {
  try {
    return readTasksFile(tasksPath)
  } catch (err) {
    throw new TasksFileReadError((err as Error).message)
  }
}

export function writeJsonOutput(data: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(data) + '\n')
}

export function writeJsonErrorAndExit(message: string, code: number): never {
  writeJsonOutput({ error: message, ok: false })
  exit(code)
}

export function resolveTasksPathOrExit(opts: {
  session?: string
  tasks?: string
}): string {
  try {
    return resolveTasksPath(opts)
  } catch (err) {
    writeJsonErrorAndExit((err as Error).message, 1)
  }
}

/**
 * Standard task CLI entrypoint glue: prints help and exits when args.help is
 * set, otherwise resolves and returns the tasks file path. Eliminates the
 * common boilerplate at the top of every task-* CLI's main().
 */
export function setupTaskCli(
  args: {
    help: boolean
    session?: string
    tasks?: string
  },
  printHelp: () => void,
): string {
  if (args.help) {
    printHelp()
    exit(0)
  }
  return resolveTasksPathOrExit({ session: args.session, tasks: args.tasks })
}

export function loadTasksFileOrExit(opts: {
  session?: string
  tasks?: string
}): { file: TasksFile; tasksPath: string } {
  const tasksPath = resolveTasksPathOrExit(opts)

  let file: TasksFile
  try {
    file = readTasksFile(tasksPath)
  } catch (err) {
    writeJsonErrorAndExit((err as Error).message, 2)
  }

  return { file, tasksPath }
}

/**
 * Help-then-load variant of `setupTaskCli` for task CLIs that also need to
 * read the tasks file up front.
 */
export function loadTasksCliOrExit(
  args: {
    help: boolean
    session?: string
    tasks?: string
  },
  printHelp: () => void,
): { file: TasksFile; tasksPath: string } {
  if (args.help) {
    printHelp()
    exit(0)
  }
  return loadTasksFileOrExit({ session: args.session, tasks: args.tasks })
}

/** @public Used by CLI scripts that filter tasks */
export interface TaskFilterOptions {
  batch?: string
  group?: string
  ids: string[]
}

export function filterTasks(tasks: Task[], opts: TaskFilterOptions): Task[] {
  let results = tasks

  if (opts.ids.length > 0) {
    const idSet = new Set(opts.ids)
    results = results.filter((t) => idSet.has(t.id))
  }
  if (opts.batch) {
    const batch = opts.batch
    results = results.filter((t) => t.batchId === batch)
  }
  if (opts.group) {
    const group = opts.group
    results = results.filter((t) => t.group === group)
  }

  return results
}

export function validateStatusOrExit(status: string): void {
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    writeJsonOutput({
      error: `Invalid status: "${status}". Must be one of: ${TASK_STATUSES.join(', ')}`,
      field: 'status',
      ok: false,
    })
    exit(1)
  }
}

/**
 * Acquires the tasks file lock, reads the file, runs `fn`, and handles
 * LockAcquisitionError / TasksFileReadError with JSON output + exit.
 */
export function withLockedTasksFile<T>(
  tasksPath: string,
  fn: (file: TasksFile) => T,
  lockOpts?: LockOptions,
): T {
  try {
    return withTasksFileLock(
      tasksPath,
      () => {
        const file = readTasksFileOrThrow(tasksPath)
        return fn(file)
      },
      lockOpts,
    )
  } catch (err) {
    if (err instanceof LockAcquisitionError) {
      writeJsonErrorAndExit(err.message, 1)
    }
    if (err instanceof TasksFileReadError) {
      writeJsonErrorAndExit(err.message, 2)
    }
    throw err
  }
}
