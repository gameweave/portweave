export type TaskStatus =
  | 'complete'
  | 'failed'
  | 'in_progress'
  | 'needs_review'
  | 'needs_rework'
  | 'todo'

export type TaskType =
  | 'lint-file'
  | 'lint-violation'
  | 'manual'
  | 'migration'
  | 'refactor'
  | 'test-coverage'

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'needs_review',
  'needs_rework',
  'complete',
  'failed',
]

export const TASK_TYPES: readonly TaskType[] = [
  'lint-violation',
  'lint-file',
  'refactor',
  'migration',
  'test-coverage',
  'manual',
]

export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  complete: [],
  failed: [],
  in_progress: ['needs_review', 'failed'],
  needs_review: ['complete', 'needs_rework'],
  needs_rework: ['in_progress', 'failed'],
  todo: ['in_progress'],
}

interface ValidationCheck {
  [key: string]: unknown
  type: string
}

export interface TaskValidation {
  checks: ValidationCheck[]
  commands: string[]
  criteria: string
}

export interface Task {
  agentHint: null | string
  assignedTo: null | string
  batchId: null | string
  completedAt: null | string
  data: Record<string, unknown>
  description: string
  error: null | string
  group: string
  id: string
  priority: number
  reworkCount: number
  status: TaskStatus
  title: string
  type: TaskType
  validation: TaskValidation
}

export interface TaskGroup {
  agentHint?: string
  priority: number
}

export interface TasksStats {
  complete: number
  failed: number
  in_progress: number
  needs_review: number
  needs_rework: number
  todo: number
}

export interface TasksMetadata {
  created: string
  description: string
  source: string
  stats: TasksStats
  totalTasks: number
}

export interface TasksFile {
  groups: Record<string, TaskGroup>
  metadata: TasksMetadata
  tasks: Task[]
}

/** @public Used by task-validator agent for retry logic */
export const DEFAULT_MAX_RETRIES = 3
