import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteRegistry, pruneStaleTempFiles } from '../atomic-write.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-atomic-'))
})

afterEach(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('atomicWriteRegistry', () => {
  it('writes contents to the destination path', async () => {
    const path = join(dir, 'registry.json')
    await atomicWriteRegistry(path, '{"entries":[],"version":1}\n')
    const contents = await readFile(path, 'utf-8')
    expect(contents).toBe('{"entries":[],"version":1}\n')
  })

  it('leaves no tempfile siblings on success', async () => {
    const path = join(dir, 'registry.json')
    await atomicWriteRegistry(path, 'hi')
    const entries = await readdir(dir)
    expect(entries.filter((e) => e.includes('.tmp.'))).toHaveLength(0)
  })

  it('overwrites an existing file atomically', async () => {
    const path = join(dir, 'registry.json')
    await writeFile(path, 'old', 'utf-8')
    await atomicWriteRegistry(path, 'new')
    expect(await readFile(path, 'utf-8')).toBe('new')
  })

  it('leaves the original file intact if writeFile to a non-existent dir fails', async () => {
    const original = join(dir, 'registry.json')
    await writeFile(original, 'original', 'utf-8')
    const badPath = join(dir, 'no-such-dir', 'registry.json')
    let threw = false
    try {
      await atomicWriteRegistry(badPath, 'never lands')
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(await readFile(original, 'utf-8')).toBe('original')
  })
})

describe('pruneStaleTempFiles', () => {
  it('removes tempfile siblings older than 60s', async () => {
    const target = join(dir, 'registry.json')
    const stale = `${target}.tmp.999.0`
    await writeFile(stale, 'stale', 'utf-8')
    const past = new Date(Date.now() - 120_000)
    await utimes(stale, past, past)
    await pruneStaleTempFiles(target)
    const remaining = await readdir(dir)
    expect(remaining.includes(`registry.json.tmp.999.0`)).toBe(false)
  })

  it('keeps recent tempfile siblings', async () => {
    const target = join(dir, 'registry.json')
    const fresh = `${target}.tmp.999.${Date.now().toString()}`
    await writeFile(fresh, 'fresh', 'utf-8')
    await pruneStaleTempFiles(target)
    const remaining = await readdir(dir)
    expect(
      remaining.some((name) => name.startsWith('registry.json.tmp.')),
    ).toBe(true)
  })

  it('does not throw when the target directory does not exist', async () => {
    const target = join(dir, 'missing', 'registry.json')
    await expect(pruneStaleTempFiles(target)).resolves.toBeUndefined()
  })

  it('does not touch unrelated files', async () => {
    await writeFile(join(dir, 'other.json'), 'x', 'utf-8')
    await pruneStaleTempFiles(join(dir, 'registry.json'))
    const entries = await readdir(dir)
    expect(entries.includes('other.json')).toBe(true)
  })
})
