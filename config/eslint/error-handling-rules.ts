/**
 * ESLint error-handling rules pinned explicitly so they survive tseslint
 * preset changes. The strictTypeChecked preset already enables all of these,
 * so pinning is a no-op at runtime but documents intent and prevents silent
 * regressions on upgrade.
 *
 * See .claude/rules/error-handling.md for the contract these rules enforce.
 */

import type { Linter } from 'eslint'

export const errorHandlingRules: Linter.RulesRecord = {
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/only-throw-error': 'error',
  '@typescript-eslint/prefer-promise-reject-errors': 'error',
  '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
}
