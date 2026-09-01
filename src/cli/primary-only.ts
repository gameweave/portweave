import type { AllocationKey } from '../worktree/key.ts'
import { MAIN_NAMESPACE } from '../worktree/namespace.ts'
import type { RunIo } from './run.ts'

// Escape hatch for --primary-only. Deliberately not PORTWEAVE_NAMESPACE=main,
// which would also move the worktree's port block.
const PRIMARY_OVERRIDE_ENV = 'PORTWEAVE_PRIMARY'

/**
 * Under --primary-only, a linked worktree skips the command entirely.
 *
 * Exit 0, not a failure: the caller is typically one task in a parallel runner
 * (`turbo dev`), and the point is that the *other* tasks still succeed. Meant
 * for a dev process that is a singleton for reasons unrelated to ports —
 * a worker that registers itself against one shared cloud project, say, where
 * a second instance silently splits work rather than colliding on a port.
 */
export function skipAsNonPrimary(key: AllocationKey, io: RunIo): boolean {
  if (key.namespace === MAIN_NAMESPACE) {
    return false
  }
  if (io.env[PRIMARY_OVERRIDE_ENV] === '1') {
    return false
  }
  io.stderr.write(
    `[portweave] --primary-only: skipping in worktree "${key.namespace}" (primary worktree owns this command; set ${PRIMARY_OVERRIDE_ENV}=1 to run it here anyway)\n`,
  )
  return true
}
