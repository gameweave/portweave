import type { TasksFile, TasksStats } from './types.ts'
import { TASK_STATUSES } from './types.ts'

export function recomputeStats(file: TasksFile): void {
  const stats: TasksStats = {
    complete: 0,
    failed: 0,
    in_progress: 0,
    needs_review: 0,
    needs_rework: 0,
    todo: 0,
  }
  for (const task of file.tasks) {
    if (TASK_STATUSES.includes(task.status)) {
      stats[task.status]++
    }
  }
  file.metadata.stats = stats
  file.metadata.totalTasks = file.tasks.length
}
