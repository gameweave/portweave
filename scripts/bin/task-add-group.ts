#!/usr/bin/env tsx

import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  resolveTasksPathOrExit,
  withLockedTasksFile,
  writeJsonOutput,
} from '../src/tasks/task-cli-helpers.ts'
import { writeTasksFile } from '../src/tasks/task-io.ts'
import type { TaskGroup, TasksFile } from '../src/tasks/types.ts'

interface ParsedArguments {
  agentHint?: string
  help: boolean
  name?: string
  priority?: number
  session?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      'agent-hint': { type: 'string' },
      help: { default: false, type: 'boolean' },
      name: { type: 'string' },
      priority: { type: 'string' },
      session: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    agentHint: values['agent-hint'],
    help: values.help,
    name: values.name,
    priority: values.priority ? parseInt(values.priority, 10) : undefined,
    session: values.session,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:add-group -- [OPTIONS]',
      '',
      'Options:',
      '  --session <name>       Session name',
      '  --tasks <path>         Explicit path to tasks.json',
      '  --name <group-name>    Group name (required)',
      '  --priority <n>         Group priority (lower = higher priority)',
      '  --agent-hint <agent>   Suggested agent for this group',
      '  --help                 Show this help message',
    ].join('\n') + '\n',
  )
}

function requireGroupName(name: string | undefined): asserts name is string {
  if (!name) {
    writeJsonOutput({
      error: 'Missing required field: name',
      field: 'name',
      ok: false,
    })
    exit(1)
  }
}

function requireValidPriority(priority: number | undefined): void {
  if (priority !== undefined && (isNaN(priority) || priority < 0)) {
    writeJsonOutput({
      error: 'Priority must be a non-negative integer',
      field: 'priority',
      ok: false,
    })
    exit(1)
  }
}

interface UpsertGroupArgs {
  agentHint?: string
  priority?: number
}

function upsertGroup(
  file: TasksFile,
  name: string,
  args: UpsertGroupArgs,
): 'created' | 'updated' {
  const hasExisting = Object.hasOwn(file.groups, name)
  const action = hasExisting ? 'updated' : 'created'

  let priority: number
  if (args.priority !== undefined) {
    priority = args.priority
  } else if (hasExisting) {
    priority = file.groups[name].priority
  } else {
    priority = 0
  }

  const newGroup: TaskGroup = { priority }

  if (args.agentHint) {
    newGroup.agentHint = args.agentHint
  } else {
    if (hasExisting) {
      const inherited = file.groups[name].agentHint
      if (inherited) {
        newGroup.agentHint = inherited
      }
    }
  }

  file.groups[name] = newGroup
  return action
}

function main(): void {
  const args = parseArguments()

  if (args.help) {
    printHelp()
    exit(0)
  }

  const name = args.name
  requireGroupName(name)
  requireValidPriority(args.priority)

  const tasksPath = resolveTasksPathOrExit({
    session: args.session,
    tasks: args.tasks,
  })

  const result = withLockedTasksFile(tasksPath, (file) => {
    const action = upsertGroup(file, name, {
      agentHint: args.agentHint,
      priority: args.priority,
    })

    writeTasksFile(tasksPath, file)

    return {
      action,
      priority: file.groups[name].priority,
    }
  })

  writeJsonOutput({
    action: result.action,
    group: name,
    ok: true,
    priority: result.priority,
  })
}

main()
