import { readFile } from 'node:fs/promises'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'

// Matches KEY=value, KEY="value", KEY='value' — key must start with a letter
// or underscore and contain only word chars.
const DOTENV_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(["']?)(.*)(\2)$/

function parseLine(
  line: string,
  lineNumber: number,
): Result<{ key: string; value: string }, PortweaveError> {
  const trimmed = line.trim()

  // Skip blank lines and comment lines
  if (trimmed === '' || trimmed.startsWith('#')) {
    return ok({ key: '', value: '' })
  }

  const match = DOTENV_LINE_PATTERN.exec(trimmed)
  if (match === null) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.ENV_DOTENV_PARSE_FAILED,
        `malformed .env line ${String(lineNumber)}: ${trimmed}`,
      ),
    )
  }

  const key = match[1]
  const quote = match[2]
  let value: string

  if (quote === '"' || quote === "'") {
    // Strip surrounding quotes (match group 3 is the inner content).
    // `#` inside a quoted value is treated literally per dotenv convention.
    value = match[3]
  } else {
    // Unquoted: everything after the =. Strip inline trailing comments
    // (` # ...` to end-of-line) since unquoted values cannot contain a `#`
    // literal without breaking dotenv consumers. Users who need a literal
    // `#` should quote the value.
    const eqIndex = trimmed.indexOf('=')
    const raw = trimmed.slice(eqIndex + 1)
    const commentMatch = /\s+#.*$/.exec(raw)
    value =
      commentMatch === null ? raw : raw.slice(0, commentMatch.index).trimEnd()
  }

  return ok({ key, value })
}

export async function readDotenvFile(
  path: string,
): Promise<Result<Record<string, string>, PortweaveError>> {
  let content: string
  try {
    content = await readFile(path, 'utf-8')
  } catch (caught: unknown) {
    if (
      typeof caught === 'object' &&
      caught !== null &&
      'code' in caught &&
      (caught as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return ok({})
    }
    throw caught
  }

  const result: Record<string, string> = {}
  const lines = content.split('\n')

  for (const [i, line] of lines.entries()) {
    const parsed = parseLine(line, i + 1)
    if (!parsed.ok) {
      return parsed
    }
    // Blank lines and comments produce key='' — skip them
    if (parsed.value.key !== '') {
      result[parsed.value.key] = parsed.value.value
    }
  }

  return ok(result)
}

export function applyDotenvOverrides(
  computed: Readonly<Record<string, string>>,
  dotenv: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, computedValue] of Object.entries(computed)) {
    result[key] = key in dotenv ? dotenv[key] : computedValue
  }

  return result
}
