const NODE_MODULES_PATTERN = 'node_modules/'
const DIST_PATTERN = 'dist/'

export const baseCoverageExclude: readonly string[] = Object.freeze([
  NODE_MODULES_PATTERN,
  DIST_PATTERN,
  '**/*.d.ts',
  '**/*.config.*',
  '**/reports/**',
  '**/__tests__/**',
  'reference/**',
])

export function coverageExcludeWith(...extra: string[]): string[] {
  return [...baseCoverageExclude, ...extra]
}

const COVERAGE_THRESHOLDS = Object.freeze({
  branches: 80,
  functions: 80,
  lines: 80,
  statements: 80,
} as const)

const COVERAGE_REPORTERS = Object.freeze([
  'text',
  'lcov',
  'html',
  'json',
] as const)

interface BuildCoverageOptions {
  exclude?: readonly string[]
  include?: readonly string[]
}

export function buildCoverageConfig(opts: BuildCoverageOptions = {}) {
  return {
    exclude: [...(opts.exclude ?? baseCoverageExclude)],
    include: [...(opts.include ?? ['src/**/*.{js,mjs,ts}'])],
    provider: 'v8' as const,
    reporter: [...COVERAGE_REPORTERS],
    reportsDirectory: 'reports/coverage',
    thresholds: { ...COVERAGE_THRESHOLDS },
  }
}
