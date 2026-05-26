import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'
import { applyDotenvOverrides, readDotenvFile } from '../dotenv-merge.ts'

async function writeTmp(content: string): Promise<string> {
  const path = join(
    tmpdir(),
    `portweave-test-${process.pid.toString()}-${Date.now().toString()}.env`,
  )
  await writeFile(path, content, 'utf-8')
  return path
}

describe('readDotenvFile', () => {
  it('returns ok({}) when the file does not exist', async () => {
    const result = await readDotenvFile('/nonexistent/path/.env')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({})
    }
  })

  it('parses KEY=value lines', async () => {
    const path = await writeTmp('API_PORT=3001\nWS_PORT=3002\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ API_PORT: '3001', WS_PORT: '3002' })
    }
  })

  it('parses double-quoted values', async () => {
    const path = await writeTmp('API_URL="http://localhost:3001"\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.API_URL).toBe('http://localhost:3001')
    }
  })

  it('parses single-quoted values', async () => {
    const path = await writeTmp("API_URL='http://localhost:3001'\n")
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.API_URL).toBe('http://localhost:3001')
    }
  })

  it('skips comment lines starting with #', async () => {
    const path = await writeTmp('# This is a comment\nAPI_PORT=3001\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ API_PORT: '3001' })
    }
  })

  it('strips inline # comments from unquoted values', async () => {
    const path = await writeTmp(
      [
        'API_PORT=3001 # primary backend',
        'WEB_PORT=3002\t# tabs work too',
        'DB_PORT=3003   #lots of spaces',
      ].join('\n'),
    )
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        API_PORT: '3001',
        DB_PORT: '3003',
        WEB_PORT: '3002',
      })
    }
  })

  it('preserves # literally inside quoted values', async () => {
    const path = await writeTmp(
      [
        'COMMENT_HASH_DOUBLE="value # not a comment"',
        "COMMENT_HASH_SINGLE='other # nope'",
      ].join('\n'),
    )
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        COMMENT_HASH_DOUBLE: 'value # not a comment',
        COMMENT_HASH_SINGLE: 'other # nope',
      })
    }
  })

  it('does not strip # that is part of the value (no preceding whitespace)', async () => {
    // Without a separating space, the # is treated as part of the value.
    // This matches how dotenv-class libraries handle the ambiguity.
    const path = await writeTmp('FRAGMENT=http://localhost:3001#section\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        FRAGMENT: 'http://localhost:3001#section',
      })
    }
  })

  it('skips blank lines', async () => {
    const path = await writeTmp('\n\nAPI_PORT=3001\n\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ API_PORT: '3001' })
    }
  })

  it('handles mixed content: comments, blanks, and key=value', async () => {
    const content = [
      '# Database config',
      '',
      'API_PORT=3001',
      'API_URL="http://localhost:3001"',
      "WS_URL='ws://localhost:3002'",
      '# end',
    ].join('\n')
    const path = await writeTmp(content)
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        API_PORT: '3001',
        API_URL: 'http://localhost:3001',
        WS_URL: 'ws://localhost:3002',
      })
    }
  })

  it('returns PW0502 for a malformed line', async () => {
    const path = await writeTmp('THIS IS NOT VALID\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PortweaveError)
      expect(result.error.code).toBe(PW_ERROR_CODES.ENV_DOTENV_PARSE_FAILED)
    }
  })

  it('returns PW0502 for a line with no = sign', async () => {
    const path = await writeTmp('API_PORT\n')
    const result = await readDotenvFile(path)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PW_ERROR_CODES.ENV_DOTENV_PARSE_FAILED)
    }
  })
})

describe('applyDotenvOverrides', () => {
  it('keeps computed keys that are not present in dotenv', () => {
    const computed = { API_PORT: '30100', WS_PORT: '30101' }
    const dotenv = {}
    const result = applyDotenvOverrides(computed, dotenv)
    expect(result).toEqual({ API_PORT: '30100', WS_PORT: '30101' })
  })

  it('lets dotenv win for shared keys', () => {
    const computed = { API_PORT: '30100', WS_PORT: '30101' }
    const dotenv = { API_PORT: '4000' }
    const result = applyDotenvOverrides(computed, dotenv)
    expect(result.API_PORT).toBe('4000')
    expect(result.WS_PORT).toBe('30101')
  })

  it('drops dotenv-only keys (keys not in computed)', () => {
    const computed = { API_PORT: '30100' }
    const dotenv = { API_PORT: '4000', OTHER_THING: 'foo', UNRELATED: 'bar' }
    const result = applyDotenvOverrides(computed, dotenv)
    expect(Object.keys(result)).toEqual(['API_PORT'])
    expect(result.OTHER_THING).toBeUndefined()
    expect(result.UNRELATED).toBeUndefined()
  })

  it('returns a new map — does not mutate computed', () => {
    const computed = { API_PORT: '30100' }
    const dotenv = { API_PORT: '4000' }
    const result = applyDotenvOverrides(computed, dotenv)
    expect(result).not.toBe(computed)
    expect(computed.API_PORT).toBe('30100')
  })
})
