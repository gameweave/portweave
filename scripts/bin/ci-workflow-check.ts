import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { findViolations } from '../src/utils/ci-workflow-parser.ts'
import type { Workflow } from '../src/utils/ci-workflow-types.ts'

const WORKFLOWS_DIR = '.github/workflows'
if (!existsSync(WORKFLOWS_DIR)) {
  process.stdout.write(
    '[portweave] ci-workflow:check skipped (no .github/workflows/)\n',
  )
  process.exit(0)
}

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter(
  (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
)

interface FileViolations {
  path: string
  violations: ReturnType<typeof findViolations>
}

const allViolations: FileViolations[] = workflowFiles
  .map((file) => {
    const path = join(WORKFLOWS_DIR, file)
    const content = readFileSync(path, 'utf-8')
    const workflow = parse(content) as Workflow
    return { path, violations: findViolations(workflow) }
  })
  .filter((entry) => entry.violations.length > 0)

let totalViolations = 0
for (const entry of allViolations) {
  process.stdout.write(`${entry.path}:\n`)
  for (const v of entry.violations) {
    process.stdout.write(
      `  job '${v.job}': install step '${v.installStepName}' (index ${v.installStepIndex.toString()}) ` +
        `appears after check step '${v.checkStepName}' (index ${v.checkStepIndex.toString()})\n`,
    )
  }
  totalViolations += entry.violations.length
}

if (totalViolations > 0) {
  process.stdout.write(
    `[portweave] ci-workflow:check failed: ${totalViolations.toString()} install-after-check violation(s)\n`,
  )
  process.exit(1)
}
process.stdout.write('[portweave] ci-workflow:check passed\n')
