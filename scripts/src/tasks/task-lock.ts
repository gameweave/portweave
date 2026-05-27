import {
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'

const { O_CREAT, O_EXCL, O_WRONLY } = constants

const DEFAULT_MAX_WAIT_MS = 10_000
const DEFAULT_RETRY_INTERVAL_MS = 50
const DEFAULT_STALE_THRESHOLD_MS = 60_000

export interface LockOptions {
  maxWaitMs?: number
  retryIntervalMs?: number
  staleThresholdMs?: number
}

export interface LockFilePayload {
  pid: number
  timestamp: string
}

export class LockAcquisitionError extends Error {
  public readonly tasksPath: string

  constructor(message: string, tasksPath: string) {
    super(message)
    this.name = 'LockAcquisitionError'
    this.tasksPath = tasksPath
  }
}

let activeLockPath: null | string = null
let exitHandlerRegistered = false

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4)
  const ia = new Int32Array(sab)
  Atomics.wait(ia, 0, 0, ms)
}

function lockFilePath(tasksPath: string): string {
  return `${tasksPath}.lock`
}

function isLockPayload(value: unknown): value is LockFilePayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as { pid?: unknown; timestamp?: unknown }
  return typeof obj.pid === 'number' && typeof obj.timestamp === 'string'
}

function parseLockPayload(raw: string): LockFilePayload | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLockPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isLockStale(
  lockPath: string,
  staleThresholdMs: number,
): boolean {
  if (!existsSync(lockPath)) {
    return false
  }
  let raw: string
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch {
    return true
  }
  const payload = parseLockPayload(raw)
  if (!payload) {
    return true
  }
  const ts = Date.parse(payload.timestamp)
  if (Number.isNaN(ts)) {
    return true
  }
  if (Date.now() - ts > staleThresholdMs) {
    return true
  }
  if (!isProcessAlive(payload.pid)) {
    return true
  }
  return false
}

function tryRemoveStaleLock(
  lockPath: string,
  staleThresholdMs: number,
): boolean {
  if (!existsSync(lockPath)) {
    return true
  }
  if (isLockStale(lockPath, staleThresholdMs)) {
    try {
      unlinkSync(lockPath)
      return true
    } catch {
      return false
    }
  }
  return false
}

function registerExitCleanup(): void {
  if (exitHandlerRegistered) {
    return
  }
  exitHandlerRegistered = true
  process.on('exit', () => {
    if (activeLockPath) {
      try {
        unlinkSync(activeLockPath)
      } catch {
        /* noop */
      }
    }
  })
}

function cleanupFailedLockWrite(lockPath: string, fd: number): void {
  try {
    closeSync(fd)
  } catch {
    /* noop */
  }
  try {
    unlinkSync(lockPath)
  } catch {
    /* noop */
  }
}

function tryExclusiveCreateLock(lockPath: string): 'exists' | number {
  try {
    return openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY, 0o644)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      return 'exists'
    }
    throw err
  }
}

function writeLockContentsAndFinish(lockPath: string, fd: number): void {
  const payload: LockFilePayload = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
  }
  const body = `${JSON.stringify(payload)}\n`
  try {
    writeSync(fd, body, 0, 'utf8')
  } catch (err) {
    cleanupFailedLockWrite(lockPath, fd)
    throw err
  }
  closeSync(fd)
}

export function acquireLock(tasksPath: string, opts: LockOptions = {}): void {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
  const retryIntervalMs = opts.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS
  const staleThresholdMs = opts.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS

  const lockPath = lockFilePath(tasksPath)
  const deadline = Date.now() + maxWaitMs

  while (Date.now() < deadline) {
    tryRemoveStaleLock(lockPath, staleThresholdMs)

    const openResult = tryExclusiveCreateLock(lockPath)
    if (openResult === 'exists') {
      sleepSync(retryIntervalMs)
      continue
    }

    writeLockContentsAndFinish(lockPath, openResult)

    activeLockPath = lockPath
    registerExitCleanup()
    return
  }

  throw new LockAcquisitionError(
    `Could not acquire lock for tasks file within ${String(maxWaitMs)}ms: ${tasksPath}`,
    tasksPath,
  )
}

export function releaseLock(tasksPath: string): void {
  const lockPath = lockFilePath(tasksPath)
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath)
    }
  } catch {
    /* noop */
  }
  if (activeLockPath === lockPath) {
    activeLockPath = null
  }
}

export function withTasksFileLock<T>(
  tasksPath: string,
  fn: () => T,
  opts?: LockOptions,
): T {
  acquireLock(tasksPath, opts)
  try {
    return fn()
  } finally {
    releaseLock(tasksPath)
  }
}
