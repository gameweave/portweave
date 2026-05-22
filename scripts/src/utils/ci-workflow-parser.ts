import type { Step, Workflow } from './ci-workflow-types.ts'

export interface Violation {
  checkStepIndex: number
  checkStepName: string
  installStepIndex: number
  installStepName: string
  job: string
}

const INSTALL_USES_PREFIXES = [
  'actions/checkout',
  'actions/setup-',
  'actions/cache',
  'dtolnay/rust-toolchain',
  'aws-actions/configure-aws-credentials',
]

const INSTALL_RUN_PATTERNS = [
  /^\s*npm ci(\s|;|$)/m,
  /^\s*if npm ci\b/m,
  /^\s*pip install\b/m,
  /^\s*cargo install\b/m,
  /^\s*npx playwright install\b/m,
  /^\s*sudo apt(-get)? install\b/m,
  /^\s*curl\s+-fsSL\b/m,
  /require\(\s*['"]@playwright\/test\/package\.json['"]\s*\)/m,
]

export function classifyStep(step: Step): 'check' | 'install' {
  if (step.uses) {
    const uses = step.uses
    if (INSTALL_USES_PREFIXES.some((p) => uses.startsWith(p))) {
      return 'install'
    }
    return 'check'
  }
  if (step.run) {
    const run = step.run
    if (INSTALL_RUN_PATTERNS.some((p) => p.test(run))) {
      return 'install'
    }
    return 'check'
  }
  return 'check'
}

function recordInstallAfterCheck(
  violations: Violation[],
  payload: {
    firstCheckIndex: number
    firstCheckName: string
    jobName: string
    step: Step
    stepIndex: number
  },
): void {
  const { firstCheckIndex, firstCheckName, jobName, step, stepIndex } = payload
  violations.push({
    checkStepIndex: firstCheckIndex,
    checkStepName: firstCheckName,
    installStepIndex: stepIndex,
    installStepName:
      step.name ?? step.run ?? step.uses ?? `step[${String(stepIndex)}]`,
    job: jobName,
  })
}

function collectJobViolations(jobName: string, steps: Step[]): Violation[] {
  const violations: Violation[] = []
  let firstCheckIndex = -1
  let firstCheckName = ''
  for (const [i, step] of steps.entries()) {
    const kind = classifyStep(step)
    if (kind === 'install') {
      if (firstCheckIndex !== -1) {
        recordInstallAfterCheck(violations, {
          firstCheckIndex,
          firstCheckName,
          jobName,
          step,
          stepIndex: i,
        })
      }
      continue
    }
    if (firstCheckIndex === -1) {
      firstCheckIndex = i
      firstCheckName =
        step.name ?? step.run ?? step.uses ?? `step[${String(i)}]`
    }
  }
  return violations
}

export function findViolations(workflow: Workflow): Violation[] {
  const violations: Violation[] = []
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!job.steps) {
      continue
    }
    violations.push(...collectJobViolations(jobName, job.steps))
  }
  return violations
}
