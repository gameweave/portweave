import { spawnSync } from 'node:child_process'

// Minimal upgrade-check: runs `npm outdated --json`. Exits 0 if no upgrades
// are available (npm outdated also exits 0 in that case), 1 if upgrades exist.
// Brian-extended version can layer in blocker filtering / semver-band logic.

const result = spawnSync('npm', ['outdated', '--json'], {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'inherit'],
})

const stdout = result.stdout || ''
if (stdout.trim() === '' || stdout.trim() === '{}') {
  process.stdout.write('[portweave] upgrade:check passed (all deps current)\n')
  process.exit(0)
}

interface Outdated {
  current: string
  latest: string
  wanted: string
}

const outdated = JSON.parse(stdout) as Record<string, Outdated>
const entries = Object.entries(outdated)
if (entries.length === 0) {
  process.stdout.write('[portweave] upgrade:check passed\n')
  process.exit(0)
}

for (const [pkg, info] of entries) {
  process.stdout.write(
    `  ${pkg}: ${info.current} → ${info.latest} (wanted ${info.wanted})\n`,
  )
}
process.stdout.write(
  `[portweave] upgrade:check found ${entries.length.toString()} outdated dep(s)\n`,
)
process.exit(1)
