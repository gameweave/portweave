import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  atomicWriteDotenv,
  ensurePortweaveDir,
  serializeDotenv,
} from '../writer.ts'

async function makeTmpDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `portweave-writer-test-${process.pid.toString()}-${Date.now().toString()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}

describe('ensurePortweaveDir', () => {
  it('creates the .portweave directory and a .gitignore with * when missing', async () => {
    const projectRoot = await makeTmpDir()
    const result = await ensurePortweaveDir(projectRoot)
    expect(result.created).toBe(true)

    const gitignore = await readFile(
      join(projectRoot, '.portweave', '.gitignore'),
      'utf-8',
    )
    expect(gitignore).toBe('*\n')
  })

  it('returns created:false on a second call and does not overwrite .gitignore', async () => {
    const projectRoot = await makeTmpDir()
    await ensurePortweaveDir(projectRoot)

    // Manually change the .gitignore content
    await writeFile(
      join(projectRoot, '.portweave', '.gitignore'),
      'custom content',
      'utf-8',
    )

    const result = await ensurePortweaveDir(projectRoot)
    expect(result.created).toBe(false)

    // Should NOT have been overwritten
    const content = await readFile(
      join(projectRoot, '.portweave', '.gitignore'),
      'utf-8',
    )
    expect(content).toBe('custom content')
  })

  it('is idempotent on repeated calls', async () => {
    const projectRoot = await makeTmpDir()
    const r1 = await ensurePortweaveDir(projectRoot)
    const r2 = await ensurePortweaveDir(projectRoot)
    const r3 = await ensurePortweaveDir(projectRoot)
    expect(r1.created).toBe(true)
    expect(r2.created).toBe(false)
    expect(r3.created).toBe(false)
  })
})

describe('atomicWriteDotenv', () => {
  it('writes the env content to the target path', async () => {
    const dir = await makeTmpDir()
    const targetPath = join(dir, 'current.env')
    const env = { API_PORT: '30100', WS_PORT: '30101' }
    await atomicWriteDotenv(targetPath, env)
    const content = await readFile(targetPath, 'utf-8')
    expect(content).toContain('API_PORT=30100')
    expect(content).toContain('WS_PORT=30101')
  })

  it('atomically replaces an existing file', async () => {
    const dir = await makeTmpDir()
    const targetPath = join(dir, 'current.env')

    await writeFile(targetPath, 'OLD_VAR=old\n', 'utf-8')
    await atomicWriteDotenv(targetPath, { NEW_VAR: 'new' })

    const content = await readFile(targetPath, 'utf-8')
    expect(content).toContain('NEW_VAR=new')
    expect(content).not.toContain('OLD_VAR')
  })

  it('leaves no tempfile after a successful write', async () => {
    const dir = await makeTmpDir()
    const targetPath = join(dir, 'current.env')
    await atomicWriteDotenv(targetPath, { API_PORT: '30100' })

    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(dir)
    // Should only have the final file, no .tmp.* siblings
    const tmpFiles = entries.filter((e) => e.includes('.tmp.'))
    expect(tmpFiles).toHaveLength(0)
  })
})

describe('serializeDotenv', () => {
  it('sorts keys ascending and produces KEY=value lines', () => {
    const result = serializeDotenv({
      API_PORT: '30100',
      WS_PORT: '30101',
    })
    expect(result).toBe('API_PORT=30100\nWS_PORT=30101\n')
  })

  it('passes through plain URL values unquoted', () => {
    const result = serializeDotenv({ VITE_API_URL: 'http://localhost:30100' })
    expect(result).toBe('VITE_API_URL=http://localhost:30100\n')
  })

  it('quotes values containing whitespace', () => {
    const result = serializeDotenv({ MY_VAR: 'hello world' })
    expect(result).toBe('MY_VAR="hello world"\n')
  })

  it('quotes values containing #', () => {
    const result = serializeDotenv({ MY_VAR: 'some#value' })
    expect(result).toBe('MY_VAR="some#value"\n')
  })

  it('quotes values containing $', () => {
    const result = serializeDotenv({ MY_VAR: 'some$value' })
    expect(result).toBe('MY_VAR="some$value"\n')
  })

  it('quotes values containing double quote and escapes it', () => {
    const result = serializeDotenv({ MY_VAR: 'say "hello"' })
    expect(result).toBe('MY_VAR="say \\"hello\\""\n')
  })

  it('quotes values containing single quote', () => {
    const result = serializeDotenv({ MY_VAR: "it's here" })
    expect(result).toBe(`MY_VAR="it's here"\n`)
  })

  it('quotes values containing backslash and escapes it', () => {
    const result = serializeDotenv({ MY_VAR: 'C:\\path' })
    expect(result).toBe('MY_VAR="C:\\\\path"\n')
  })

  it('produces a trailing newline', () => {
    const result = serializeDotenv({ API_PORT: '30100' })
    expect(result.endsWith('\n')).toBe(true)
  })

  it('produces empty string for an empty map', () => {
    const result = serializeDotenv({})
    expect(result).toBe('')
  })
})
