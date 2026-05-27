import { spawnSync } from 'node:child_process'

interface Step {
  name: string
  script: string
}

const FORMAT_CHECK = 'format:check'
const LINT = 'lint'
const TYPECHECK = 'typecheck'
const DUPCHECK = 'dupcheck'
const SIMILARITY_CHECK = 'similarity:check'
const DEADCODE_CHECK = 'deadcode:check'
const STRUCTURE_CHECK = 'structure:check'
const COMPLEXITY_CHECK = 'complexity:check'
const CONSTANTS_CHECK = 'constants:check'
const DOCS_FRESHNESS_CHECK = 'docs:freshness:check'
const CI_WORKFLOW_CHECK = 'ci-workflow:check'
const TEST = 'test'
const UPGRADE_CHECK = 'upgrade:check'

// Order: format → lint → typecheck → static
// analysis → tests → security. Order matters: fast/cheap checks first so
// expensive ones don't run if a basic gate fails.
const STEPS: Step[] = [
  { name: FORMAT_CHECK, script: FORMAT_CHECK },
  { name: LINT, script: LINT },
  { name: TYPECHECK, script: TYPECHECK },
  { name: DUPCHECK, script: DUPCHECK },
  { name: SIMILARITY_CHECK, script: SIMILARITY_CHECK },
  { name: DEADCODE_CHECK, script: DEADCODE_CHECK },
  { name: STRUCTURE_CHECK, script: STRUCTURE_CHECK },
  { name: COMPLEXITY_CHECK, script: COMPLEXITY_CHECK },
  { name: CONSTANTS_CHECK, script: CONSTANTS_CHECK },
  { name: DOCS_FRESHNESS_CHECK, script: DOCS_FRESHNESS_CHECK },
  { name: CI_WORKFLOW_CHECK, script: CI_WORKFLOW_CHECK },
  { name: TEST, script: TEST },
  { name: UPGRADE_CHECK, script: UPGRADE_CHECK },
]

const skipTests = process.argv.includes('--skip-tests')
const quick = process.argv.includes('--quick')

function shouldSkip(stepName: string): boolean {
  if (skipTests && stepName === TEST) {
    return true
  }
  if (!quick) {
    return false
  }
  return (
    stepName === TEST ||
    stepName === UPGRADE_CHECK ||
    stepName === SIMILARITY_CHECK
  )
}

function statusIcon(status: 'failed' | 'passed' | 'skipped'): string {
  if (status === 'passed') {
    return '✓'
  }
  if (status === 'failed') {
    return '✗'
  }
  return '−'
}

interface StepResult {
  duration: number
  name: string
  status: 'failed' | 'passed' | 'skipped'
}

function runStep(step: Step): StepResult {
  if (shouldSkip(step.name)) {
    return { duration: 0, name: step.name, status: 'skipped' }
  }
  const start = Date.now()
  process.stdout.write(`\n=== ${step.name} ===\n`)
  const result = spawnSync('npm', ['run', step.script], { stdio: 'inherit' })
  const duration = Date.now() - start
  const status: 'failed' | 'passed' = result.status === 0 ? 'passed' : 'failed'
  return { duration, name: step.name, status }
}

const results: StepResult[] = []
let firstFailure: null | string = null

for (const step of STEPS) {
  if (firstFailure !== null) {
    break
  }
  const result = runStep(step)
  results.push(result)
  if (result.status === 'failed') {
    firstFailure = step.name
  }
}

process.stdout.write('\n=== dev-workflow summary ===\n')
for (const r of results) {
  process.stdout.write(
    `  ${statusIcon(r.status)} ${r.name} (${(r.duration / 1000).toFixed(2)}s)\n`,
  )
}

if (firstFailure !== null) {
  process.stdout.write(
    `\n[portweave] dev-workflow FAILED at: ${firstFailure}\n`,
  )
  process.exit(1)
}
process.stdout.write('\n[portweave] dev-workflow PASSED\n')
