import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import canonical from 'eslint-plugin-canonical'
import { importX } from 'eslint-plugin-import-x'
import perfectionist from 'eslint-plugin-perfectionist'
import sonarjs from 'eslint-plugin-sonarjs'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'
import { complexityRules } from './config/eslint/complexity-rules.ts'
import { errorHandlingRules } from './config/eslint/error-handling-rules.ts'
import { fileTypeOverrides } from './config/eslint/file-type-overrides.ts'
import { perfectionistRules } from './config/eslint/perfectionist-rules.ts'
import { qualityRules } from './config/eslint/quality-rules.ts'
import {
  allowDefaultProject,
  toolingOverrides,
} from './config/eslint/tooling-overrides.ts'

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/reports/**',
      '**/coverage/**',
      '**/*.js.map',
      'reference/**',
      '.claude/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject,
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 52,
        },
      },
    },
    plugins: {
      '@stylistic': stylistic,
      canonical,
      'import-x': importX,
      perfectionist,
      sonarjs,
    },
    rules: {
      ...complexityRules,
      ...errorHandlingRules,
      ...qualityRules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'canonical/filename-match-exported': 'error',
      'canonical/no-export-all': 'error',
      'canonical/no-import-namespace-destructure': 'error',
      'canonical/no-reassign-imports': 'error',
      curly: 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'never',
        },
      ],
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          message: 'Relative imports must include a file extension',
          selector:
            'ImportDeclaration[source.value=/^\\..*(?<!\\.js)(?<!\\.ts)(?<!\\.json)(?<!\\.md)$/]',
        },
        {
          message: 'Relative re-exports must include a file extension',
          selector:
            'ExportNamedDeclaration[source.value=/^\\..*(?<!\\.js)(?<!\\.ts)(?<!\\.json)(?<!\\.md)$/]',
        },
      ],
      'no-undef': 'off',
      ...perfectionistRules,
      'sort-keys': 'off',
    },
    settings: {
      'import-x/internal-regex': '^portweave',
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
  },
  ...fileTypeOverrides,
  toolingOverrides,
)
