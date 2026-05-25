import { spawnSync } from 'node:child_process'

// upgrade-check classifies `npm outdated --json` findings along two axes so
// the gate is deterministic from the lockfile alone (independent of wall time).
//
// Axis 1 — in-band vs out-of-band:
//   in-band:     info.wanted !== info.current  (lockfile is behind what
//                package.json allows; `npm ci` would produce a different tree
//                than `npm install` would now produce)
//   out-of-band: only info.latest > info.wanted  (upstream released past our
//                pinned semver range; informational only — depends on wall time)
//
// Axis 2 — semver level of the in-band jump (current → wanted):
//   MAJOR: current.major !== wanted.major
//   MINOR: same major, different minor
//   PATCH: same major+minor, different patch
//
// Default rules (gate invoked from dev-workflow):
//   in-band MAJOR or MINOR → fail
//   in-band PATCH          → advisory (exit 0)
//   out-of-band any level  → advisory (exit 0)
//
// Flags (not invoked from dev-workflow; reserved for maintenance sessions):
//   --strict           also fail on out-of-band findings
//   --include-patches  also fail on in-band PATCH findings

const PASSED_LINE = '[portweave] upgrade:check passed\n'

type SemverLevel = 'major' | 'minor' | 'patch' | 'same'

interface Outdated {
  current: string
  latest: string
  wanted: string
}

interface Classified {
  inBand: boolean
  info: Outdated
  level: SemverLevel
  pkg: string
}

// Strip pre-release / build metadata; we only need the numeric M.m.p triple
// for level classification. Non-semver versions (git refs, dist-tags) return
// null and are treated as MAJOR-equivalent by the caller.
function parseSemver(v: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (match === null) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function classifyLevel(from: string, to: string): SemverLevel {
  const a = parseSemver(from)
  const b = parseSemver(to)
  if (a === null || b === null) {
    return from === to ? 'same' : 'major'
  }
  if (a[0] !== b[0]) {
    return 'major'
  }
  if (a[1] !== b[1]) {
    return 'minor'
  }
  if (a[2] !== b[2]) {
    return 'patch'
  }
  return 'same'
}

function classify(pkg: string, info: Outdated): Classified {
  const inBand = info.wanted !== info.current
  const level = classifyLevel(info.current, info.wanted)
  return { inBand, info, level, pkg }
}

function shouldFail(
  c: Classified,
  flags: { includePatches: boolean; strict: boolean },
): boolean {
  if (c.inBand) {
    if (c.level === 'patch') {
      return flags.includePatches
    }
    return c.level === 'minor' || c.level === 'major'
  }
  return flags.strict
}

function formatLine(c: Classified): string {
  const bucket = c.inBand ? `in-band ${c.level.toUpperCase()}` : `out-of-band`
  return `  ${c.pkg}: ${c.info.current} → ${c.info.latest} (wanted ${c.info.wanted}) [${bucket}]`
}

function main(): number {
  const strict = process.argv.includes('--strict')
  const includePatches = process.argv.includes('--include-patches')
  const flags = { includePatches, strict }

  const result = spawnSync('npm', ['outdated', '--json'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  const stdout = result.stdout || ''
  if (stdout.trim() === '' || stdout.trim() === '{}') {
    process.stdout.write(
      '[portweave] upgrade:check passed (all deps current)\n',
    )
    return 0
  }

  const outdated = JSON.parse(stdout) as Record<string, Outdated>
  const entries = Object.entries(outdated)
  if (entries.length === 0) {
    process.stdout.write(PASSED_LINE)
    return 0
  }

  const classified = entries.map(([pkg, info]) => classify(pkg, info))
  const failing = classified.filter((c) => shouldFail(c, flags))
  const advisories = classified.filter((c) => !shouldFail(c, flags))

  if (advisories.length > 0) {
    process.stdout.write('[portweave] upgrade:check advisories:\n')
    for (const c of advisories) {
      process.stdout.write(formatLine(c) + '\n')
    }
  }

  if (failing.length === 0) {
    const summary =
      advisories.length > 0
        ? `[portweave] upgrade:check passed (${advisories.length.toString()} advisory)\n`
        : PASSED_LINE
    process.stdout.write(summary)
    return 0
  }

  process.stdout.write('[portweave] upgrade:check blocking:\n')
  for (const c of failing) {
    process.stdout.write(formatLine(c) + '\n')
  }
  process.stdout.write(
    `[portweave] upgrade:check found ${failing.length.toString()} blocking upgrade(s)\n`,
  )
  return 1
}

process.exit(main())
