#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  setupTaskCli,
  withLockedTasksFile,
  writeJsonOutput,
} from '../src/tasks/task-cli-helpers.ts'
import { writeTasksFile } from '../src/tasks/task-io.ts'
import { initIdCounter, validateTaskInput } from '../src/tasks/validate-task.ts'

interface ParsedArguments {
  data?: string
  description?: string
  group?: string
  help: boolean
  id?: string
  priority?: number
  session?: string
  tasks?: string
  title?: string
  type?: string
  validation?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      data: { type: 'string' },
      description: { type: 'string' },
      group: { type: 'string' },
      help: { default: false, type: 'boolean' },
      id: { type: 'string' },
      priority: { type: 'string' },
      session: { type: 'string' },
      tasks: { type: 'string' },
      title: { type: 'string' },
      type: { type: 'string' },
      validation: { type: 'string' },
    },
  })
  return {
    data: values.data,
    description: values.description,
    group: values.group,
    help: values.help,
    id: values.id,
    priority: values.priority ? parseInt(values.priority, 10) : undefined,
    session: values.session,
    tasks: values.tasks,
    title: values.title,
    type: values.type,
    validation: values.validation,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:add -- [OPTIONS]',
      '',
      'Options:',
      '  --session <name>        Session name',
      '  --tasks <path>          Explicit path to tasks.json',
      '  --type <task-type>      Task type (lint-violation, lint-file, refactor, migration, test-coverage, manual)',
      '  --group <group>         Group name for batching',
      '  --priority <n>          Priority (lower = higher priority)',
      '  --title <string>        Short task title',
      '  --description <text>    Task description',
      '  --data <json>           JSON string with type-specific data',
      '  --validation <json>     JSON string with validation criteria',
      '  --id <string>           Task ID (auto-generated if omitted)',
      '  --help                  Show this help message',
    ].join('\n') + '\n',
  )
}

function main(): void {
  const args = parseArguments()
  const tasksPath = setupTaskCli(args, printHelp)

  type AddOutcome =
    | {
        error: string
        field?: string
        kind: 'validation_error'
      }
    | {
        id: string
        kind: 'ok'
        message: string
      }

  const outcome = withLockedTasksFile<AddOutcome>(tasksPath, (file) => {
    const existingIds = new Set(file.tasks.map((t) => t.id))
    initIdCounter(file.tasks)

    const result = validateTaskInput(
      {
        data: args.data,
        description: args.description,
        group: args.group,
        id: args.id,
        priority: args.priority,
        title: args.title,
        type: args.type,
        validation: args.validation,
      },
      existingIds,
    )

    if (!result.task) {
      return {
        error: result.error ?? 'Validation failed',
        field: result.field,
        kind: 'validation_error',
      }
    }

    file.tasks.push(result.task)
    writeTasksFile(tasksPath, file)

    return {
      id: result.task.id,
      kind: 'ok',
      message: `Added task ${result.task.id} to group ${result.task.group}`,
    }
  })

  if (outcome.kind === 'validation_error') {
    writeJsonOutput({
      error: outcome.error,
      field: outcome.field,
      ok: false,
    })
    exit(1)
  }

  writeJsonOutput({
    id: outcome.id,
    message: outcome.message,
    ok: true,
  })
}

main()
