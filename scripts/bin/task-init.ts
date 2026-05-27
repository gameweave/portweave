#!/usr/bin/env tsx

import { existsSync } from 'node:fs'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import { createEmptyTasksFile, writeTasksFile } from '../src/tasks/task-io.ts'
import {
  resolveTasksPath,
  validateSessionName,
  writeActiveMarker,
} from '../src/tasks/resolve-session.ts'

interface ParsedArguments {
  description: string
  force: boolean
  help: boolean
  session?: string
  source: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      description: { default: '', type: 'string' },
      force: { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      session: { type: 'string' },
      source: { default: '', type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    description: values.description,
    force: values.force,
    help: values.help,
    session: values.session,
    source: values.source,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:init -- [OPTIONS]',
      '',
      'Options:',
      '  --session <name>      Session name (creates .ai/sessions/<name>/tasks.json)',
      '  --tasks <path>        Explicit path to tasks.json',
      '  --source <string>     Source command that generated the tasks',
      '  --description <text>  Description of the task session',
      '  --force               Overwrite existing tasks.json',
      '  --help                Show this help message',
    ].join('\n') + '\n',
  )
}

function requireSessionOrTasks(args: ParsedArguments): void {
  if (!args.session && !args.tasks) {
    process.stdout.write(
      JSON.stringify({
        error: 'Either --session or --tasks is required',
        ok: false,
      }) + '\n',
    )
    exit(1)
  }
}

function validateSessionArgIfPresent(session: string | undefined): void {
  if (!session) {
    return
  }
  const nameError = validateSessionName(session)
  if (nameError) {
    process.stdout.write(
      JSON.stringify({ error: nameError, field: 'session', ok: false }) + '\n',
    )
    exit(1)
  }
}

function resolveTasksPathOrExit(args: ParsedArguments): string {
  try {
    return resolveTasksPath({
      session: args.session,
      tasks: args.tasks,
    })
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        error: (err as Error).message,
        ok: false,
      }) + '\n',
    )
    exit(1)
  }
}

function assertTasksFileWritable(tasksPath: string, force: boolean): void {
  if (existsSync(tasksPath) && !force) {
    process.stdout.write(
      JSON.stringify({
        error: `Tasks file already exists at ${tasksPath}. Use --force to overwrite.`,
        ok: false,
        path: tasksPath,
      }) + '\n',
    )
    exit(1)
  }
}

function writeInitSuccess(
  session: string | undefined,
  tasksPath: string,
): void {
  const sessionSuffix = session ? ` session ${session}` : ''
  process.stdout.write(
    JSON.stringify({
      message: `Initialized${sessionSuffix} with 0 tasks`,
      ok: true,
      path: tasksPath,
      session: session ?? null,
    }) + '\n',
  )
}

function main(): void {
  const args = parseArguments()

  if (args.help) {
    printHelp()
    exit(0)
  }

  requireSessionOrTasks(args)
  validateSessionArgIfPresent(args.session)
  const tasksPath = resolveTasksPathOrExit(args)
  assertTasksFileWritable(tasksPath, args.force)

  const file = createEmptyTasksFile(args.source, args.description)
  writeTasksFile(tasksPath, file)

  if (args.session) {
    writeActiveMarker(args.session)
  }

  writeInitSuccess(args.session, tasksPath)
}

main()
