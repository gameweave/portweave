import { mkdir, rm, stat } from 'node:fs/promises'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'

const LOCK_RETRY_COUNT_DEFAULT = 100
const LOCK_RETRY_DELAY_MS = 25
const STALE_LOCK_MS = 30_000

interface LockAttemptConfig {
  readonly retryCount: number
  readonly retryDelayMs: number
  readonly staleMs: number
}

function getErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return undefined
  }
  const code = value.code
  return typeof code === 'string' ? code : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveLockConfig(): LockAttemptConfig {
  const raw = process.env.PORTWEAVE_LOCK_TIMEOUT_MS
  if (raw === undefined || raw.length === 0) {
    return {
      retryCount: LOCK_RETRY_COUNT_DEFAULT,
      retryDelayMs: LOCK_RETRY_DELAY_MS,
      staleMs: STALE_LOCK_MS,
    }
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      retryCount: LOCK_RETRY_COUNT_DEFAULT,
      retryDelayMs: LOCK_RETRY_DELAY_MS,
      staleMs: STALE_LOCK_MS,
    }
  }
  return {
    retryCount: Math.max(1, Math.ceil(parsed / LOCK_RETRY_DELAY_MS)),
    retryDelayMs: LOCK_RETRY_DELAY_MS,
    staleMs: STALE_LOCK_MS,
  }
}

async function tryRemoveStaleLock(
  lockDir: string,
  staleMs: number,
): Promise<void> {
  try {
    const info = await stat(lockDir)
    if (Date.now() - info.mtimeMs > staleMs) {
      await rm(lockDir, { force: true, recursive: true })
    }
  } catch (caught: unknown) {
    // pw-allow-swallow: ENOENT means the lock vanished concurrently — no action needed.
    // Any other error is unexpected; remove forcefully as best-effort and let the
    // retry loop surface the failure.
    if (getErrorCode(caught) !== 'ENOENT') {
      await rm(lockDir, { force: true, recursive: true })
    }
  }
}

async function tryAcquire(lockDir: string): Promise<boolean> {
  try {
    await mkdir(lockDir)
    return true
  } catch (caught: unknown) {
    if (getErrorCode(caught) === 'EEXIST') {
      return false
    }
    throw caught
  }
}

export async function withLock<T>(
  lockDir: string,
  fn: () => Promise<T>,
): Promise<Result<T, PortweaveError>> {
  const config = resolveLockConfig()
  for (let attempt = 0; attempt < config.retryCount; attempt++) {
    const acquired = await tryAcquire(lockDir)
    if (acquired) {
      try {
        const value = await fn()
        return ok(value)
      } finally {
        await rm(lockDir, { force: true, recursive: true })
      }
    }
    await tryRemoveStaleLock(lockDir, config.staleMs)
    await sleep(config.retryDelayMs)
  }
  return err(
    new PortweaveError(
      PW_ERROR_CODES.REGISTRY_LOCKED,
      `timed out acquiring registry lock at ${lockDir} after ${config.retryCount.toString()} retries`,
    ),
  )
}
