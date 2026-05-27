#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  filterTasks,
  resolveTasksPathOrExit,
  validateStatusOrExit,
  withLockedTasksFile,
  writeJsonOutput,
} from '../src/tasks/task-cli-helpers.ts'
import { writeTasksFile } from '../src/tasks/task-io.ts'
import type { Task, TasksFile, TaskStatus } from '../src/tasks/types.ts'
import { VALID_TRANSITIONS } from '../src/tasks/types.ts'

interface ParsedArguments {
  batch?: string
  error?: string
  group?: string
  help: boolean
  ids: string[]
  lockTimeoutMs?: number
  session?: string
  status?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      batch: { type: 'string' },
      error: { type: 'string' },
      group: { type: 'string' },
      help: { default: false, type: 'boolean' },
      id: { multiple: true, type: 'string' },
      'lock-timeout': { type: 'string' },
      session: { type: 'string' },
      status: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    batch: values.batch,
    error: values.error,
    group: values.group,
    help: values.help,
    ids: values.id ?? [],
    lockTimeoutMs: values['lock-timeout']
      ? parseInt(values['lock-timeout'], 10)
      : undefined,
    session: values.session,
    status: values.status,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:set-status -- [OPTIONS]',
      '',
      'Options:',
      '  --session <name>   Session name',
      '  --tasks <path>     Explicit path to tasks.json',
      '  --id <id>          Task ID (repeatable)',
      '  --batch <batch-id> Select tasks by batch ID',
      '  --group <group>    Select tasks by group',
      '  --status <status>  Target status',
      '  --error <msg>      Error message (for needs_rework or failed)',
      '  --lock-timeout <ms> Max wait to acquire tasks file lock (default: 10000)',
      '  --help             Show this help message',
    ].join('\n') + '\n',
  )
}

function validateInput(args: ParsedArguments): void {
  if (!args.status) {
    writeJsonOutput({
      error: 'Missing required field: status',
      field: 'status',
      ok: false,
    })
    exit(1)
  }

  validateStatusOrExit(args.status)

  if (args.ids.length === 0 && !args.batch && !args.group) {
    writeJsonOutput({
      error: 'At least one of --id, --batch, or --group is required',
      ok: false,
    })
    exit(1)
  }
}

function applyTargetStatusToTask(
  task: Task,
  args: ParsedArguments,
  targetStatus: TaskStatus,
  errors: { error: string; id: string }[],
): boolean {
  const allowed = VALID_TRANSITIONS[task.status]
  if (!allowed.includes(targetStatus)) {
    errors.push({
      error: `Cannot transition from ${task.status} to ${targetStatus}`,
      id: task.id,
    })
    return false
  }

  task.status = targetStatus
  task.error = args.error ?? null

  if (targetStatus === 'needs_rework') {
    task.reworkCount++
  }
  if (targetStatus === 'complete' || targetStatus === 'failed') {
    task.completedAt = new Date().toISOString()
  }

  return true
}

interface StatusUpdateResult {
  exitCode: number
  output: Record<string, unknown>
}

function processStatusUpdate(
  tasksPath: string,
  file: TasksFile,
  args: ParsedArguments,
  targetStatus: TaskStatus,
): StatusUpdateResult {
  const matched = filterTasks(file.tasks, {
    batch: args.batch,
    group: args.group,
    ids: args.ids,
  })

  if (matched.length === 0) {
    return {
      exitCode: 1,
      output: {
        error: 'No tasks matched the given filters',
        ok: false,
      },
    }
  }

  const updated: string[] = []
  const errors: { error: string; id: string }[] = []

  for (const task of matched) {
    if (applyTargetStatusToTask(task, args, targetStatus, errors)) {
      updated.push(task.id)
    }
  }

  writeTasksFile(tasksPath, file)

  if (errors.length > 0 && updated.length === 0) {
    return {
      exitCode: 1,
      output: { errors, ok: false, updated: 0 },
    }
  }

  return {
    exitCode: 0,
    output: {
      errors: errors.length > 0 ? errors : undefined,
      ids: updated,
      ok: true,
      status: targetStatus,
      updated: updated.length,
    },
  }
}

function main(): void {
  const args = parseArguments()

  if (args.help) {
    printHelp()
    exit(0)
  }

  validateInput(args)
  const targetStatus = args.status as TaskStatus
  const tasksPath = resolveTasksPathOrExit({
    session: args.session,
    tasks: args.tasks,
  })
  const lockOpts =
    args.lockTimeoutMs !== undefined
      ? { maxWaitMs: args.lockTimeoutMs }
      : undefined

  const updateResult = withLockedTasksFile<StatusUpdateResult>(
    tasksPath,
    (file) => processStatusUpdate(tasksPath, file, args, targetStatus),
    lockOpts,
  )

  writeJsonOutput(updateResult.output)
  exit(updateResult.exitCode)
}

main()
