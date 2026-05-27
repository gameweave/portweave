#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  filterTasks,
  loadTasksFileOrExit,
  validateStatusOrExit,
  writeJsonOutput,
} from '../src/tasks/task-cli-helpers.ts'

interface ParsedArguments {
  batch?: string
  help: boolean
  ids: string[]
  json: boolean
  session?: string
  status?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      batch: { type: 'string' },
      help: { default: false, type: 'boolean' },
      id: { multiple: true, type: 'string' },
      json: { default: false, type: 'boolean' },
      session: { type: 'string' },
      status: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    batch: values.batch,
    help: values.help,
    ids: values.id ?? [],
    json: values.json,
    session: values.session,
    status: values.status,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:get -- [OPTIONS]',
      '',
      'Options:',
      '  --session <name>   Session name',
      '  --tasks <path>     Explicit path to tasks.json',
      '  --id <id>          Task ID (repeatable)',
      '  --batch <batch-id> Filter by batch ID',
      '  --status <status>  Filter by status',
      '  --json             Output JSON (default for this script)',
      '  --help             Show this help message',
    ].join('\n') + '\n',
  )
}

function main(): void {
  const args = parseArguments()

  if (args.help) {
    printHelp()
    exit(0)
  }

  if (args.status) {
    validateStatusOrExit(args.status)
  }

  const { file } = loadTasksFileOrExit({
    session: args.session,
    tasks: args.tasks,
  })

  let tasks = filterTasks(file.tasks, {
    batch: args.batch,
    ids: args.ids,
  })
  if (args.status) {
    tasks = tasks.filter((t) => t.status === args.status)
  }

  writeJsonOutput({ count: tasks.length, ok: true, tasks })
}

main()
