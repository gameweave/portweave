#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import log from 'loglevel'
import {
  loadTasksCliOrExit,
  writeJsonOutput,
} from '../src/tasks/task-cli-helpers.ts'
import type { TasksFile } from '../src/tasks/types.ts'

log.setLevel('info')

interface ParsedArguments {
  help: boolean
  json: boolean
  session?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      help: { default: false, type: 'boolean' },
      json: { default: false, type: 'boolean' },
      session: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    help: values.help,
    json: values.json,
    session: values.session,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:check-complete -- [OPTIONS]',
      '',
      'Exit 0 if all tasks are complete or failed. Exit 1 otherwise.',
      '',
      'Options:',
      '  --session <name>   Session name',
      '  --tasks <path>     Explicit path to tasks.json',
      '  --json             Output JSON',
      '  --help             Show this help message',
    ].join('\n') + '\n',
  )
}

function reportResult(file: TasksFile, json: boolean): void {
  const { stats, totalTasks } = file.metadata
  const done = stats.complete
  const failed = stats.failed
  const remaining = {
    in_progress: stats.in_progress,
    needs_review: stats.needs_review,
    needs_rework: stats.needs_rework,
    todo: stats.todo,
  }
  const actionable =
    remaining.todo +
    remaining.in_progress +
    remaining.needs_review +
    remaining.needs_rework
  const isComplete = actionable === 0

  if (json) {
    writeJsonOutput({
      complete: isComplete,
      done,
      failed,
      ok: true,
      remaining,
      total: totalTasks,
    })
    exit(isComplete ? 0 : 1)
  }

  if (isComplete) {
    log.info(
      `✅ All tasks finished: ${String(done)} complete, ${String(failed)} failed out of ${String(totalTasks)} total`,
    )
    exit(0)
  }

  log.info(
    `❌ ${String(actionable)} tasks remaining out of ${String(totalTasks)} total (${String(done)} complete, ${String(failed)} failed)`,
  )
  for (const [status, count] of Object.entries(remaining)) {
    if (count > 0) {
      log.info(`  ${status}: ${String(count)}`)
    }
  }
  exit(1)
}

function main(): void {
  const args = parseArguments()
  const { file } = loadTasksCliOrExit(args, printHelp)

  reportResult(file, args.json)
}

main()
