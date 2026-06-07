import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const KILOBYTE = 1024 as const

/**
 * Runs `du -sk <worktreeRoot>` and resolves its stdout. Non-blocking (network/
 * disk-bound on cold caches), so it must never serialize the snapshot's
 * per-worktree fetches. Injected in tests so CI never depends on a real `du`.
 */
export type RunDu = (worktreeRoot: string) => Promise<string>

const defaultRunDu: RunDu = async (worktreeRoot) => {
  const { stdout } = await execFileAsync('du', ['-sk', worktreeRoot])
  return stdout
}

/**
 * Worktree size in bytes via `du -sk` (kilobytes ×1024), or null when
 * unavailable — non-du platform (Windows), spawn failure, non-zero exit, or
 * unparseable output. Never throws: size is a best-effort triage signal and the
 * frontend renders "—" on null.
 */
export async function diskSizeBytes(
  worktreeRoot: string,
  runDu: RunDu = defaultRunDu,
): Promise<null | number> {
  if (process.platform === 'win32') {
    return null
  }

  try {
    const stdout = await runDu(worktreeRoot)
    const kilobytes = parseLeadingKilobytes(stdout)
    return kilobytes === null ? null : kilobytes * KILOBYTE
  } catch {
    // pw-allow-swallow: size is best-effort — null on failure
    return null
  }
}

// `du -sk` emits "<kb>\t<path>"; take the leading integer. A NaN/missing value
// (empty or malformed stdout) is treated as unavailable, not a zero-byte tree.
function parseLeadingKilobytes(stdout: string): null | number {
  const leading = stdout.trim().split(/\s+/u, 1)[0] ?? ''
  const kilobytes = Number.parseInt(leading, 10)
  return Number.isInteger(kilobytes) && kilobytes >= 0 ? kilobytes : null
}
