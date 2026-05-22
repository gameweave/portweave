/**
 * ESLint code quality rules — SonarJS rules detecting correctness issues,
 * anti-patterns, and code smells (not structural complexity).
 */

import type { Linter } from 'eslint'

export const qualityRules: Linter.RulesRecord = {
  'sonarjs/different-types-comparison': 'error',
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-array-delete': 'error',
  'sonarjs/no-collection-size-mischeck': 'error',
  'sonarjs/no-duplicate-string': ['error', { threshold: 2 }],
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-element-overwrite': 'error',
  'sonarjs/no-empty-collection': 'error',
  'sonarjs/no-extra-arguments': 'error',
  'sonarjs/no-gratuitous-expressions': 'error',
  'sonarjs/no-identical-conditions': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-ignored-return': 'error',
  'sonarjs/no-inconsistent-returns': 'error',
  'sonarjs/no-inverted-boolean-check': 'error',
  'sonarjs/no-nested-template-literals': 'error',
  'sonarjs/no-redundant-boolean': 'error',
  'sonarjs/no-redundant-jump': 'error',
  'sonarjs/no-same-line-conditional': 'error',
  'sonarjs/no-small-switch': 'error',
  'sonarjs/no-unused-collection': 'error',
  'sonarjs/no-use-of-empty-return-value': 'error',
  'sonarjs/no-useless-catch': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'sonarjs/prefer-object-literal': 'error',
  'sonarjs/prefer-single-boolean-return': 'error',
  'sonarjs/prefer-while': 'error',
}
