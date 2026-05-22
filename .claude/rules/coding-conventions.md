# Coding Conventions

## Style

- Single quotes for strings
- No semicolons
- Trailing commas
- 2-space indentation
- Prettier handles formatting (config: `.prettierrc`)

## TypeScript

- Strict mode enabled
- Use `type` imports where possible (`import type { Foo } from '...'`)
- Target ES2024, module Node16, `verbatimModuleSyntax` on
- Single package at v0 (not a monorepo). If/when we grow into framework adapters, monorepo is on the table.

## Result vs throw

- Functions that can fail with expected error modes return `Result<T, E>`. Callers narrow on `result.ok`.
- True invariant violations / unrecoverable conditions throw.
- See [error-handling.md](./error-handling.md) for the full contract.

## Error codes

Portweave reserves the `PW` prefix for any diagnostic / error-code namespace we introduce. Number ranges land as the first user-facing diagnostic surface emerges; until then, use plain error messages.

## Comments

Default to no comments. Only add when the _why_ is non-obvious (hidden constraint, subtle invariant, workaround for a specific bug, behavior that would surprise a reader). Don't explain _what_ — well-named identifiers do that.

## File and directory naming

- Source code: `kebab-case.ts` filenames; classes/types in PascalCase exports.
- Tests: `[source-file].test.ts` co-located in `__tests__/` directories next to the source.
- One default export when the module is "named after" its export; otherwise prefer named exports.
- ESLint enforces `canonical/filename-match-exported` and `canonical/no-export-all`.

## Imports

- Relative imports must include the file extension (e.g., `'./foo.ts'`, not `'./foo'`).
- Import order is fixed by `import-x/order`: builtin → external → internal → parent → sibling → index.
- Sorted within each group (`perfectionist/sort-named-imports`).

## What ESLint enforces

The flat config at `eslint.config.ts` pulls in:

- `eslint.configs.recommended`
- `typescript-eslint` strict + stylistic type-checked
- Complexity rules from `config/eslint/complexity-rules.ts`
- Quality rules from `config/eslint/quality-rules.ts` (SonarJS)
- Error-handling pins from `config/eslint/error-handling-rules.ts`
- Perfectionist sort rules from `config/eslint/perfectionist-rules.ts`

Run `npm run lint` to enforce, `npm run lint:fix` to auto-fix.
