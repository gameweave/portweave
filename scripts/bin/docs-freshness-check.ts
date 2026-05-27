import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Minimal docs-freshness check: walk docs/ for *.md files, parse YAML frontmatter
// for `lastReviewedAt`, fail if any are older than thresholdDays.

const DEFAULT_THRESHOLD_DAYS = 30

function parseThreshold(): number {
  const i = process.argv.indexOf('--threshold')
  if (i === -1) {
    return DEFAULT_THRESHOLD_DAYS
  }
  const parsed = Number(process.argv[i + 1])
  return Number.isFinite(parsed) ? parsed : DEFAULT_THRESHOLD_DAYS
}

const thresholdDays = parseThreshold()

const DOCS_ROOT = 'docs'
if (!existsSync(DOCS_ROOT)) {
  process.stdout.write(
    '[portweave] docs:freshness:check skipped (no docs/ dir)\n',
  )
  process.exit(0)
}

function walkMarkdown(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      walkMarkdown(full, acc)
    } else if (entry.endsWith('.md')) {
      acc.push(full)
    } else {
      // Non-markdown file — ignored.
    }
  }
  return acc
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/
const LAST_REVIEWED_RE = /lastReviewedAt:\s*(\S+)/

interface Stale {
  daysOld: number
  file: string
  lastReviewedAt: string
}

interface StaleProbe {
  daysOld: number
  lastReviewedAt: string
  stale: boolean
}

function probeFile(file: string, now: number): null | StaleProbe {
  const content = readFileSync(file, 'utf-8')
  const fm = FRONTMATTER_RE.exec(content)
  if (!fm) {
    return null
  }
  const lr = LAST_REVIEWED_RE.exec(fm[1])
  if (!lr) {
    return null
  }
  const date = new Date(lr[1])
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const daysOld = Math.floor((now - date.getTime()) / 86_400_000)
  return {
    daysOld,
    lastReviewedAt: lr[1],
    stale: daysOld > thresholdDays,
  }
}

const now = Date.now()
const stale: Stale[] = walkMarkdown(DOCS_ROOT)
  .map((file) => ({ file, probe: probeFile(file, now) }))
  .filter(
    (entry): entry is { file: string; probe: StaleProbe } =>
      entry.probe?.stale === true,
  )
  .map((entry) => ({
    daysOld: entry.probe.daysOld,
    file: entry.file,
    lastReviewedAt: entry.probe.lastReviewedAt,
  }))

if (stale.length === 0) {
  process.stdout.write('[portweave] docs:freshness:check passed\n')
  process.exit(0)
}

for (const s of stale) {
  process.stdout.write(`  ${s.file} (${s.daysOld.toString()} days old)\n`)
}
process.stdout.write(
  `[portweave] docs:freshness:check failed: ${stale.length.toString()} stale doc(s)\n`,
)
process.exit(1)
