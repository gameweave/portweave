#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import log from 'loglevel'
import { loadTasksCliOrExit } from '../src/tasks/task-cli-helpers.ts'
import type { TasksFile } from '../src/tasks/types.ts'
import { TASK_STATUSES } from '../src/tasks/types.ts'

log.setLevel('info')

interface ParsedArguments {
  byGroup: boolean
  byType: boolean
  help: boolean
  json: boolean
  session?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      'by-group': { default: false, type: 'boolean' },
      'by-type': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      json: { default: false, type: 'boolean' },
      session: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    byGroup: values['by-group'],
    byType: values['by-type'],
    help: values.help,
    json: values.json,
    session: values.session,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:status -- [OPTIONS]',
      '',
      'Options:',
      '  --session <name>   Session name',
      '  --tasks <path>     Explicit path to tasks.json',
      '  --json             Output JSON',
      '  --by-group         Break down by group',
      '  --by-type          Break down by task type',
      '  --help             Show this help message',
    ].join('\n') + '\n',
  )
}

function buildBreakdown(
  file: TasksFile,
  key: 'group' | 'type',
): Record<string, Record<string, number>> {
  const breakdown: Record<string, Record<string, number>> = {}
  for (const task of file.tasks) {
    const bucket = task[key]
    breakdown[bucket] ??= {}
    breakdown[bucket][task.status] = (breakdown[bucket][task.status] ?? 0) + 1
  }
  return breakdown
}

function printBreakdownSection(
  file: TasksFile,
  key: 'group' | 'type',
  label: string,
): void {
  log.info('')
  log.info(`By ${label}:`)
  const breakdown = buildBreakdown(file, key)
  for (const [name, counts] of Object.entries(breakdown).sort()) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const parts = Object.entries(counts)
      .map(([s, c]) => `${String(c)} ${s}`)
      .join(', ')
    log.info(`  ${name} (${String(total)}): ${parts}`)
  }
}

function printHumanOutput(file: TasksFile, args: ParsedArguments): void {
  const { stats, totalTasks } = file.metadata
  const done = stats.complete + stats.failed
  const pct = totalTasks > 0 ? Math.round((done / totalTasks) * 100) : 0
  const barWidth = 30
  const filled = Math.round((pct / 100) * barWidth)
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)

  log.info('📋 Task Status')
  log.info('==============')
  log.info(
    `Progress: [${bar}] ${String(pct)}% (${String(done)}/${String(totalTasks)})`,
  )
  log.info('')
  for (const status of TASK_STATUSES) {
    const count = stats[status]
    if (count > 0) {
      log.info(`  ${status}: ${String(count)}`)
    }
  }

  if (args.byGroup) {
    printBreakdownSection(file, 'group', 'group')
  }

  if (args.byType) {
    printBreakdownSection(file, 'type', 'type')
  }
}

function main(): void {
  const args = parseArguments()
  const { file } = loadTasksCliOrExit(args, printHelp)

  if (args.json) {
    const output: Record<string, unknown> = {
      ok: true,
      stats: file.metadata.stats,
      total: file.metadata.totalTasks,
    }
    if (args.byGroup) {
      output.byGroup = buildBreakdown(file, 'group')
    }
    if (args.byType) {
      output.byType = buildBreakdown(file, 'type')
    }
    process.stdout.write(JSON.stringify(output) + '\n')
    exit(0)
  }

  printHumanOutput(file, args)
}

main()
