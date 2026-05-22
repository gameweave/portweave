/**
 * ESLint complexity rules — measure structural complexity, function/file
 * size, and nesting depth. These rules are run by `npm run complexity:check`.
 */

import type { Linter } from 'eslint'

export const COMPLEXITY_RULE_NAMES = [
  'complexity',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-params',
  'max-statements',
  '@stylistic/max-statements-per-line',
  'sonarjs/cognitive-complexity',
  'sonarjs/expression-complexity',
  'sonarjs/nested-control-flow',
  'sonarjs/no-collapsible-if',
  'sonarjs/no-nested-conditional',
  'sonarjs/no-nested-functions',
  'sonarjs/no-nested-switch',
  'sonarjs/too-many-break-or-continue-in-loop',
  'sonarjs/elseif-without-else',
  'sonarjs/max-switch-cases',
] as const

export const complexityRules: Linter.RulesRecord = {
  '@stylistic/max-statements-per-line': ['error', { max: 1 }],
  complexity: ['error', { max: 10 }],
  'max-depth': ['error', { max: 4 }],
  'max-lines': [
    'error',
    {
      max: 250,
      skipBlankLines: false,
      skipComments: false,
    },
  ],
  'max-lines-per-function': ['error', { max: 150 }],
  'max-nested-callbacks': ['error', { max: 3 }],
  'max-params': ['error', { max: 4 }],
  'max-statements': ['error', { max: 30 }],
  'sonarjs/cognitive-complexity': ['error', 15],
  'sonarjs/elseif-without-else': 'error',
  'sonarjs/expression-complexity': 'error',
  'sonarjs/max-switch-cases': ['error', 30],
  'sonarjs/nested-control-flow': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/no-nested-conditional': 'error',
  'sonarjs/no-nested-functions': 'error',
  'sonarjs/no-nested-switch': 'error',
  'sonarjs/too-many-break-or-continue-in-loop': 'error',
}
