import { execFile } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface LaunchResult {
  readonly launched: boolean
  readonly reason?: string
}

/**
 * Spawns a launcher. The contract is security-critical: `args` is always an
 * argv ARRAY (never a shell string), so a worktreeRoot containing shell
 * metacharacters cannot inject a command. Resolves `{ ok: true }` once the
 * child has spawned, `{ ok: false }` on a spawn failure (e.g. ENOENT).
 */
export type SpawnLauncher = (
  cmd: string,
  args: string[],
) => Promise<{ ok: boolean }> | { ok: boolean }

/** True if `bin` is resolvable as an executable on PATH. */
export type WhichProbe = (bin: string) => boolean

interface LaunchDeps {
  readonly platform?: string
  readonly spawn?: SpawnLauncher
  readonly which?: WhichProbe
}

const EDITOR_CANDIDATES = ['code', 'cursor'] as const
const LAUNCH_FAILED = 'launch-failed' as const
const OPEN = 'open' as const

/**
 * Launches an external editor or terminal at `worktreeRoot` on macOS via an
 * argv-array spawn — never a shell, so a path with shell metacharacters cannot
 * inject a command. Never throws: every failure mode resolves to a
 * `{ launched: false, reason }` so the route stays graceful (B-8). The server
 * validates `worktreeRoot` against the registry before calling — this module
 * only does the platform check, launcher selection, and the argv spawn.
 */
export async function launchAt(
  target: 'editor' | 'terminal',
  worktreeRoot: string,
  deps: LaunchDeps = {},
): Promise<LaunchResult> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'darwin') {
    return { launched: false, reason: 'unsupported-platform' }
  }

  const spawn = deps.spawn ?? defaultSpawn
  const which = deps.which ?? defaultWhich

  const command =
    target === 'terminal'
      ? terminalCommand(worktreeRoot)
      : editorCommand(worktreeRoot, which)

  if (command === null) {
    return { launched: false, reason: 'no-editor-found' }
  }

  return tryLaunch(spawn, command.cmd, command.args)
}

function editorCommand(
  worktreeRoot: string,
  which: WhichProbe,
): null | { args: string[]; cmd: string } {
  const configured = process.env.PORTWEAVE_EDITOR
  if (configured !== undefined && configured !== '') {
    return { args: [worktreeRoot], cmd: configured }
  }

  const onPath = EDITOR_CANDIDATES.find((bin) => which(bin))
  if (onPath !== undefined) {
    return { args: [worktreeRoot], cmd: onPath }
  }

  if (which(OPEN)) {
    return { args: ['-a', 'Visual Studio Code', worktreeRoot], cmd: OPEN }
  }

  return null
}

function terminalCommand(worktreeRoot: string): { args: string[]; cmd: string } {
  return { args: ['-a', 'Terminal', worktreeRoot], cmd: OPEN }
}

async function tryLaunch(
  spawn: SpawnLauncher,
  cmd: string,
  args: string[],
): Promise<LaunchResult> {
  try {
    const result = await spawn(cmd, args)
    return result.ok
      ? { launched: true }
      : { launched: false, reason: LAUNCH_FAILED }
  } catch {
    // pw-allow-swallow: launch is best-effort — any spawn failure is a no-op
    return { launched: false, reason: LAUNCH_FAILED }
  }
}

// Real spawn: argv-array execFile (NEVER { shell: true }), detached so the GUI
// app outlives this short-lived panel process. Resolves { ok: false } if the
// child emits an 'error' (e.g. ENOENT) before it spawns.
const defaultSpawn: SpawnLauncher = (cmd, args) =>
  new Promise((resolve) => {
    let settled = false
    const settle = (ok: boolean): void => {
      if (!settled) {
        settled = true
        resolve({ ok })
      }
    }

    const child = execFile(cmd, args, { shell: false })
    child.once('error', () => {
      settle(false)
    })
    child.once('spawn', () => {
      child.unref()
      settle(true)
    })
  })

// Real PATH probe: walk PATH entries for an executable file, no shell involved.
const defaultWhich: WhichProbe = (bin) => {
  const pathValue = process.env.PATH ?? ''
  return pathValue
    .split(delimiter)
    .filter((dir) => dir !== '')
    .some((dir) => isExecutable(join(dir, bin)))
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, fsConstants.X_OK)
    return true
  } catch {
    // pw-allow-swallow: a non-executable / missing candidate just isn't a match
    return false
  }
}
