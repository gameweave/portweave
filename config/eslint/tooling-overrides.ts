import type { Linter } from 'eslint'

const ESLINT_CONFIG = 'eslint.config.ts'
const VITEST_SHARED = 'vitest.shared.ts'

export const allowDefaultProject: string[] = [
  ESLINT_CONFIG,
  'config/eslint/complexity-rules.ts',
  'config/eslint/error-handling-rules.ts',
  'config/eslint/file-type-overrides.ts',
  'config/eslint/globs.ts',
  'config/eslint/perfectionist-rules.ts',
  'config/eslint/quality-rules.ts',
  'config/eslint/tooling-overrides.ts',
  'vitest.config.ts',
  'vitest.setup.ts',
  VITEST_SHARED,
]

export const toolingOverrides: Linter.Config = {
  files: [
    'config/eslint/**/*.ts',
    ESLINT_CONFIG,
    '**/vitest.config.ts',
    '**/vitest.setup.ts',
    VITEST_SHARED,
  ],
  rules: {
    '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
    '@typescript-eslint/no-unnecessary-condition': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-useless-default-assignment': 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'off',
    'canonical/filename-match-exported': 'off',
  },
}
