import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// Minimal structure-check: enforce that *.test.ts files live inside __tests__/
// directories, and that each test file has a corresponding source file.
// Brian-extended version can grow into the full boardflip rule set.

const ROOTS = ['src', 'scripts']

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      walk(full, acc)
    } else if (entry.endsWith('.test.ts')) {
      acc.push(full)
    } else {
      // Non-test file in a walkable dir — ignored.
    }
  }
  return acc
}

interface Violation {
  file: string
  message: string
}

const violations: Violation[] = []
for (const root of ROOTS) {
  for (const testFile of walk(root)) {
    const dir = dirname(testFile)
    if (basename(dir) !== '__tests__') {
      violations.push({
        file: testFile,
        message: 'test file must live inside a __tests__/ directory',
      })
    }
    const stem = basename(testFile, '.test.ts')
    const sourceDir = dirname(dir)
    const sourcePath = join(sourceDir, `${stem}.ts`)
    if (!existsSync(sourcePath)) {
      violations.push({
        file: testFile,
        message: `no matching source file at ${sourcePath}`,
      })
    }
  }
}

if (violations.length === 0) {
  process.stdout.write('[portweave] structure:check passed\n')
  process.exit(0)
}

for (const v of violations) {
  process.stdout.write(`  ${v.file}: ${v.message}\n`)
}
process.stdout.write(
  `[portweave] structure:check failed: ${violations.length.toString()} violation(s)\n`,
)
process.exit(1)
