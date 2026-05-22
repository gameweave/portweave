import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SESSIONS_DIR = '.ai/sessions'
const ACTIVE_MARKER = '.active'
const TASKS_FILENAME = 'tasks.json'

function assertSafeSessionName(name: string): void {
  const error = validateSessionName(name)
  if (error) {
    throw new Error(error)
  }
}

export function resolveTasksPath(opts: {
  session?: string
  tasks?: string
}): string {
  if (opts.tasks) {
    return resolve(opts.tasks)
  }
  if (opts.session) {
    assertSafeSessionName(opts.session)
    return resolve(join(SESSIONS_DIR, opts.session, TASKS_FILENAME))
  }
  const markerPath = resolve(join(SESSIONS_DIR, ACTIVE_MARKER))
  if (existsSync(markerPath)) {
    const sessionName = readFileSync(markerPath, 'utf8').trim()
    if (sessionName.length > 0) {
      assertSafeSessionName(sessionName)
      return resolve(join(SESSIONS_DIR, sessionName, TASKS_FILENAME))
    }
  }
  throw new Error(
    'No session specified. Use --session <name> or --tasks <path>, or set an active session with task:init.',
  )
}

export function sessionNameFromPath(tasksPath: string): null | string {
  const normalized = tasksPath.replace(/\\/g, '/')
  const marker = `${SESSIONS_DIR}/`
  const idx = normalized.indexOf(marker)
  if (idx === -1) {
    return null
  }
  const afterMarker = normalized.slice(idx + marker.length)
  const slashIdx = afterMarker.indexOf('/')
  if (slashIdx === -1) {
    return null
  }
  return afterMarker.slice(0, slashIdx)
}

export function writeActiveMarker(sessionName: string): void {
  const dir = resolve(SESSIONS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ACTIVE_MARKER), sessionName + '\n', 'utf8')
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateSessionName(name: string): null | string {
  if (!KEBAB_RE.test(name)) {
    return `Session name must be kebab-case (lowercase letters, numbers, hyphens). Got: "${name}"`
  }
  return null
}
