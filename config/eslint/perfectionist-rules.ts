import type { Linter } from 'eslint'

const SORT_ASC_NATURAL: Linter.RuleEntry = [
  'error',
  { order: 'asc', type: 'natural' },
]

export const perfectionistRules: Linter.RulesRecord = {
  'perfectionist/sort-enums': SORT_ASC_NATURAL,
  'perfectionist/sort-exports': SORT_ASC_NATURAL,
  'perfectionist/sort-interfaces': SORT_ASC_NATURAL,
  'perfectionist/sort-intersection-types': SORT_ASC_NATURAL,
  'perfectionist/sort-maps': SORT_ASC_NATURAL,
  'perfectionist/sort-named-exports': SORT_ASC_NATURAL,
  'perfectionist/sort-named-imports': SORT_ASC_NATURAL,
  'perfectionist/sort-object-types': SORT_ASC_NATURAL,
  'perfectionist/sort-objects': SORT_ASC_NATURAL,
  'perfectionist/sort-switch-case': SORT_ASC_NATURAL,
  'perfectionist/sort-union-types': SORT_ASC_NATURAL,
}
