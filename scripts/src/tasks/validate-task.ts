import type { Task, TaskType, TaskValidation } from './types.ts'
import { TASK_TYPES } from './types.ts'

export interface TaskInput {
  agentHint?: null | string
  data?: Record<string, unknown> | string
  description?: string
  group?: string
  id?: string
  priority?: number
  title?: string
  type?: string
  validation?: string | TaskValidation
}

/** @public Used by CLI scripts that validate task input */
export interface TaskValidationResult {
  error?: string
  field?: string
  task?: Task
}

let nextIdCounter = 0

export function generateTaskId(existingIds: Set<string>): string {
  nextIdCounter++
  let id = `task-${String(nextIdCounter).padStart(3, '0')}`
  while (existingIds.has(id)) {
    nextIdCounter++
    id = `task-${String(nextIdCounter).padStart(3, '0')}`
  }
  return id
}

export function initIdCounter(existingTasks: { id: string }[]): void {
  let max = 0
  for (const t of existingTasks) {
    const match = /^task-(\d+)$/.exec(t.id)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > max) {
        max = num
      }
    }
  }
  nextIdCounter = max
}

function validateRequiredFields(input: TaskInput): null | TaskValidationResult {
  if (!input.type) {
    return { error: 'Missing required field: type', field: 'type' }
  }
  if (!TASK_TYPES.includes(input.type as TaskType)) {
    return {
      error: `Invalid type: "${input.type}". Must be one of: ${TASK_TYPES.join(', ')}`,
      field: 'type',
    }
  }
  if (!input.group) {
    return { error: 'Missing required field: group', field: 'group' }
  }
  if (!input.title) {
    return { error: 'Missing required field: title', field: 'title' }
  }
  return null
}

const ERR_DATA_NOT_OBJECT = 'data must be a plain object'
const ERR_VALIDATION_SHAPE =
  'validation must be an object with checks (array of {type: string}), commands (array of strings), and criteria (string)'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDataField(
  input: TaskInput,
): TaskValidationResult | { data: Record<string, unknown> } {
  if (typeof input.data === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.data) as unknown
    } catch {
      return { error: 'Invalid JSON in data field', field: 'data' }
    }
    if (!isPlainObject(parsed)) {
      return { error: ERR_DATA_NOT_OBJECT, field: 'data' }
    }
    return { data: parsed }
  }
  if (input.data !== undefined && !isPlainObject(input.data)) {
    return { error: ERR_DATA_NOT_OBJECT, field: 'data' }
  }
  return { data: input.data ?? {} }
}

function isValidationCheck(item: unknown): item is { type: string } {
  return isPlainObject(item) && typeof item.type === 'string'
}

function isValidTaskValidation(value: unknown): value is TaskValidation {
  if (!isPlainObject(value)) {
    return false
  }
  if (
    !Array.isArray(value.checks) ||
    !Array.isArray(value.commands) ||
    typeof value.criteria !== 'string'
  ) {
    return false
  }
  return (
    value.checks.every(isValidationCheck) &&
    value.commands.every((c: unknown) => typeof c === 'string')
  )
}

function parseValidationField(
  input: TaskInput,
): TaskValidationResult | { validation: TaskValidation } {
  if (typeof input.validation === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.validation) as unknown
    } catch {
      return {
        error: 'Invalid JSON in validation field',
        field: 'validation',
      }
    }
    if (!isValidTaskValidation(parsed)) {
      return { error: ERR_VALIDATION_SHAPE, field: 'validation' }
    }
    return { validation: parsed }
  }
  if (
    input.validation !== undefined &&
    !isValidTaskValidation(input.validation)
  ) {
    return { error: ERR_VALIDATION_SHAPE, field: 'validation' }
  }
  return {
    validation: input.validation ?? { checks: [], commands: [], criteria: '' },
  }
}

function validatePriority(input: TaskInput): null | TaskValidationResult {
  const priority = input.priority ?? 0
  if (
    !Number.isFinite(priority) ||
    priority < 0 ||
    !Number.isInteger(priority)
  ) {
    return {
      error: 'priority must be a finite non-negative integer',
      field: 'priority',
    }
  }
  return null
}

function buildValidatedTask(
  input: TaskInput,
  existingIds: Set<string>,
  data: Record<string, unknown>,
  validation: TaskValidation,
): TaskValidationResult {
  if (input.id && existingIds.has(input.id)) {
    return { error: `Duplicate id: ${input.id}`, field: 'id' }
  }

  const id = input.id ?? generateTaskId(existingIds)
  existingIds.add(id)

  const task: Task = {
    agentHint: input.agentHint ?? null,
    assignedTo: null,
    batchId: null,
    completedAt: null,
    data,
    description: input.description ?? '',
    error: null,
    group: input.group ?? '',
    id,
    priority: input.priority ?? 0,
    reworkCount: 0,
    status: 'todo',
    title: input.title ?? '',
    type: input.type as TaskType,
    validation,
  }

  return { task }
}

export function validateTaskInput(
  input: TaskInput,
  existingIds: Set<string>,
): TaskValidationResult {
  const fieldError = validateRequiredFields(input)
  if (fieldError) {
    return fieldError
  }

  const dataResult = parseDataField(input)
  if ('error' in dataResult) {
    return dataResult
  }

  const validationResult = parseValidationField(input)
  if ('error' in validationResult) {
    return validationResult
  }

  const priorityError = validatePriority(input)
  if (priorityError) {
    return priorityError
  }

  const { data } = dataResult as { data: Record<string, unknown> }
  const { validation } = validationResult as { validation: TaskValidation }
  return buildValidatedTask(input, existingIds, data, validation)
}
