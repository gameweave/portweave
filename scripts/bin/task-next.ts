#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  setupTaskCli,
  withLockedTasksFile,
} from '../src/tasks/task-cli-helpers.ts'
import { writeTasksFile } from '../src/tasks/task-io.ts'
import type { Task, TasksFile } from '../src/tasks/types.ts'

interface ParsedArguments {
  batchSize: number
  help: boolean
  includeRework: boolean
  json: boolean
  lockTimeoutMs?: number
  session?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      'batch-size': { default: '10', type: 'string' },
      help: { default: false, type: 'boolean' },
      'include-rework': { default: false, type: 'boolean' },
      json: { default: false, type: 'boolean' },
      'lock-timeout': { type: 'string' },
      session: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    batchSize: parseInt(values['batch-size'], 10),
    help: values.help,
    includeRework: values['include-rework'],
    json: values.json,
    lockTimeoutMs: values['lock-timeout']
      ? parseInt(values['lock-timeout'], 10)
      : undefined,
    session: values.session,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:next -- [OPTIONS]',
      '',
      'Claims the next highest-priority batch of tasks.',
      '',
      'Options:',
      '  --session <name>     Session name',
      '  --tasks <path>       Explicit path to tasks.json',
      '  --batch-size <n>     Max tasks per batch (default: 10)',
      '  --include-rework     Include needs_rework tasks (prioritized first)',
      '  --json               Output JSON (default for this script)',
      '  --lock-timeout <ms>  Max wait to acquire tasks file lock (default: 10000)',
      '  --help               Show this help message',
    ].join('\n') + '\n',
  )
}

function maxBatchNumFromId(batchId: string, currentMax: number): number {
  const match = /^batch-(\d+)$/.exec(batchId)
  if (!match) {
    return currentMax
  }
  const num = parseInt(match[1], 10)
  return num > currentMax ? num : currentMax
}

function generateBatchId(file: TasksFile): string {
  let maxNum = 0
  for (const task of file.tasks) {
    if (task.batchId) {
      maxNum = maxBatchNumFromId(task.batchId, maxNum)
    }
  }
  return `batch-${String(maxNum + 1).padStart(3, '0')}`
}

function getGroupPriority(file: TasksFile, groupName: string): number {
  if (!(groupName in file.groups)) {
    return Number.MAX_SAFE_INTEGER
  }
  return file.groups[groupName].priority
}

function compareTasksForNext(file: TasksFile, a: Task, b: Task): number {
  const statusOrder = a.status === 'needs_rework' ? 0 : 1
  const statusOrderB = b.status === 'needs_rework' ? 0 : 1
  if (statusOrder !== statusOrderB) {
    return statusOrder - statusOrderB
  }
  const groupPrioA = getGroupPriority(file, a.group)
  const groupPrioB = getGroupPriority(file, b.group)
  if (groupPrioA !== groupPrioB) {
    return groupPrioA - groupPrioB
  }
  if (a.priority !== b.priority) {
    return a.priority - b.priority
  }
  return 0
}

function selectTasks(
  file: TasksFile,
  batchSize: number,
  includeRework: boolean,
): Task[] {
  const candidates: Task[] = []

  if (includeRework) {
    candidates.push(...file.tasks.filter((t) => t.status === 'needs_rework'))
  }
  candidates.push(...file.tasks.filter((t) => t.status === 'todo'))

  if (candidates.length === 0) {
    return []
  }

  candidates.sort((a, b) => compareTasksForNext(file, a, b))

  const inProgressGroups = new Set(
    file.tasks.filter((t) => t.status === 'in_progress').map((t) => t.group),
  )
  const available = candidates.filter((t) => !inProgressGroups.has(t.group))
  if (available.length === 0) {
    return []
  }

  const topGroup = available[0].group
  const groupCandidates = available.filter((t) => t.group === topGroup)
  return groupCandidates.slice(0, batchSize)
}

type NextResult =
  | {
      agentHint: null | string
      batchId: string
      claimedTasks: Task[]
      group: string
      kind: 'claimed'
    }
  | { kind: 'empty' }

function main(): void {
  const args = parseArguments()
  const tasksPath = setupTaskCli(args, printHelp)
  const lockOpts =
    args.lockTimeoutMs !== undefined
      ? { maxWaitMs: args.lockTimeoutMs }
      : undefined

  const result = withLockedTasksFile<NextResult>(
    tasksPath,
    (file) => {
      const selected = selectTasks(file, args.batchSize, args.includeRework)

      if (selected.length === 0) {
        return { kind: 'empty' }
      }

      const batchId = generateBatchId(file)
      const group = selected[0].group
      const agentHint =
        group in file.groups ? (file.groups[group].agentHint ?? null) : null

      const selectedIds = new Set(selected.map((t) => t.id))
      for (const task of file.tasks) {
        if (selectedIds.has(task.id)) {
          task.status = 'in_progress'
          task.batchId = batchId
          task.assignedTo = batchId
        }
      }

      writeTasksFile(tasksPath, file)

      const claimedTasks = file.tasks.filter((t) => selectedIds.has(t.id))
      return {
        agentHint,
        batchId,
        claimedTasks,
        group,
        kind: 'claimed',
      }
    },
    lockOpts,
  )

  if (result.kind === 'empty') {
    process.stdout.write(
      JSON.stringify({
        batchId: null,
        count: 0,
        message: 'No actionable tasks remaining',
        ok: true,
        tasks: [],
      }) + '\n',
    )
    exit(0)
  }

  process.stdout.write(
    JSON.stringify({
      agentHint: result.agentHint,
      batchId: result.batchId,
      count: result.claimedTasks.length,
      group: result.group,
      ok: true,
      tasks: result.claimedTasks,
    }) + '\n',
  )
}

main()
