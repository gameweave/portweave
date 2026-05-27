import { spawnSync } from 'node:child_process'
import { COMPLEXITY_RULE_NAMES } from '../../config/eslint/complexity-rules.ts'

// Run ESLint with JSON formatter and filter to complexity rules only.
const result = spawnSync('eslint', ['.', '--format', 'json'], {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'inherit'],
})

if (result.error) {
  process.stderr.write(
    `[portweave] complexity:check failed: ${result.error.message}\n`,
  )
  process.exit(1)
}

interface EslintMessage {
  column: number
  line: number
  message: string
  ruleId: null | string
}
interface EslintFileResult {
  filePath: string
  messages: EslintMessage[]
}

const complexityRules = new Set<string>(COMPLEXITY_RULE_NAMES)
const files = JSON.parse(result.stdout || '[]') as EslintFileResult[]
const filesWithMatches = files
  .map((file) => ({
    filePath: file.filePath,
    matched: file.messages.filter(
      (m) => m.ruleId !== null && complexityRules.has(m.ruleId),
    ),
  }))
  .filter((entry) => entry.matched.length > 0)

let violations = 0
for (const entry of filesWithMatches) {
  process.stdout.write(`${entry.filePath}\n`)
  for (const m of entry.matched) {
    process.stdout.write(
      `  ${m.line.toString()}:${m.column.toString()}  ${m.ruleId ?? ''}  ${m.message}\n`,
    )
    violations += 1
  }
}

if (violations > 0) {
  process.stdout.write(
    `[portweave] complexity:check found ${violations.toString()} violation(s)\n`,
  )
  process.exit(1)
}
process.stdout.write('[portweave] complexity:check passed\n')
