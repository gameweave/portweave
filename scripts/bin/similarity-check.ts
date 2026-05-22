import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const SIMILARITY_TS = 'similarity-ts'

// similarity-ts is a Rust tool — must be installed separately via `cargo install similarity-ts`.
// On a fresh machine without Rust/cargo, skip with a warning rather than failing the workflow.
const probe = spawnSync(SIMILARITY_TS, ['--version'], { stdio: 'ignore' })
if (probe.error !== undefined || probe.status !== 0) {
  process.stderr.write(
    '[portweave] similarity:check skipped (similarity-ts not installed). ' +
      'Run `cargo install similarity-ts` to enable.\n',
  )
  process.exit(0)
}

const targets = ['src', '__tests__', 'scripts'].filter((p) => existsSync(p))
if (targets.length === 0) {
  process.exit(0)
}

const result = spawnSync(SIMILARITY_TS, targets, { stdio: 'inherit' })
process.exit(result.status ?? 1)
