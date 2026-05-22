/**
 * Worker entry for task-lock concurrency tests (see task-lock.test.ts).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { acquireLock, releaseLock } from './task-lock.ts'

const { tasksPath } = workerData as { tasksPath: string }

acquireLock(tasksPath)
parentPort?.postMessage({ type: 'ready' })

parentPort?.on('message', (msg: unknown) => {
  if (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: string }).type === 'release'
  ) {
    releaseLock(tasksPath)
    parentPort?.postMessage({ type: 'released' })
  }
})
