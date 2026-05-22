#!/usr/bin/env tsx

import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  setupTaskCli,
  withLockedTasksFile,
  writeJsonErrorAndExit,
  writeJsonOutput,
} from '../src/tasks/task-cli-helpers.ts'
import { writeTasksFile } from '../src/tasks/task-io.ts'
import type { TasksFile } from '../src/tasks/types.ts'
import type { TaskInput } from '../src/tasks/validate-task.ts'
import { initIdCounter, validateTaskInput } from '../src/tasks/validate-task.ts'

interface ParsedArguments {
  help: boolean
  input?: string
  session?: string
  tasks?: string
}

function parseArguments(): ParsedArguments {
  const { values } = parseArgs({
    options: {
      help: { default: false, type: 'boolean' },
      input: { type: 'string' },
      session: { type: 'string' },
      tasks: { type: 'string' },
    },
  })
  return {
    help: values.help,
    input: values.input,
    session: values.session,
    tasks: values.tasks,
  }
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: npm run task:add-batch -- [OPTIONS]',
      '',
      'Reads a JSON array of task objects from stdin or a file.',
      '',
      'Options:',
      '  --session <name>   Session name',
      '  --tasks <path>     Explicit path to tasks.json',
      '  --input <file>     Read tasks from file (reads stdin if omitted)',
      '  --help             Show this help message',
    ].join('\n') + '\n',
  )
}

function readInput(inputPath?: string): string {
  if (inputPath) {
    return readFileSync(inputPath, 'utf8')
  }
  return readFileSync(0, 'utf8')
}

function exitWithReadError(err: unknown): never {
  return writeJsonErrorAndExit(
    `Failed to read input: ${(err as Error).message}`,
    2,
  )
}

function exitWithParseError(err: unknown): never {
  return writeJsonErrorAndExit(
    `Invalid input format: ${(err as Error).message}`,
    1,
  )
}

function readTaskInputsOrExit(inputPath?: string): TaskInput[] {
  let rawInput: string
  try {
    rawInput = readInput(inputPath)
  } catch (err) {
    exitWithReadError(err)
  }

  try {
    const taskInputs = JSON.parse(rawInput) as TaskInput[]
    if (!Array.isArray(taskInputs)) {
      throw new Error('Input must be a JSON array')
    }
    return taskInputs
  } catch (err) {
    exitWithParseError(err)
  }
}

interface BatchProcessResult {
  exitCode: number
  output: Record<string, unknown>
}

function processTaskBatch(
  tasksPath: string,
  file: TasksFile,
  taskInputs: TaskInput[],
): BatchProcessResult {
  const existingIds = new Set(file.tasks.map((t) => t.id))
  initIdCounter(file.tasks)

  let added = 0
  const errors: { error: string; index: number }[] = []

  for (let i = 0; i < taskInputs.length; i++) {
    const result = validateTaskInput(taskInputs[i], existingIds)
    if (result.task) {
      file.tasks.push(result.task)
      added++
    } else {
      errors.push({ error: result.error ?? 'Unknown error', index: i })
    }
  }

  writeTasksFile(tasksPath, file)

  const rejected = errors.length
  const output: Record<string, unknown> = {
    added,
    errors: rejected > 0 ? errors : undefined,
    ok: rejected === 0,
    rejected,
    total: taskInputs.length,
  }
  return { exitCode: rejected > 0 ? 1 : 0, output }
}

function main(): void {
  const args = parseArguments()
  const tasksPath = setupTaskCli(args, printHelp)

  const taskInputs = readTaskInputsOrExit(args.input)

  const batchResult = withLockedTasksFile<BatchProcessResult>(
    tasksPath,
    (file) => processTaskBatch(tasksPath, file, taskInputs),
  )

  writeJsonOutput(batchResult.output)
  exit(batchResult.exitCode)
}

main()
