/**
 * ESLint overrides scoped to specific file types (tests, scripts).
 * Relaxes rules that don't apply in those environments.
 */

import type { Linter } from 'eslint'
import { GLOB_SPEC_TS, GLOB_TEST_TS } from './globs.ts'

export const fileTypeOverrides: Linter.Config[] = [
  {
    files: [GLOB_TEST_TS, GLOB_SPEC_TS],
    rules: {
      'max-lines': 'off',
      'max-nested-callbacks': 'off',
      'max-statements': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/__mocks__/**'],
    rules: {
      'canonical/filename-match-regex': 'off',
      'import-x/prefer-default-export': 'off',
      'no-restricted-syntax': 'off',
    },
  },
]
