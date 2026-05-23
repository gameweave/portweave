import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { loadRegistryFile, serializeRegistry } from '../serialize.ts'
import type { RegistryEntry, RegistryFile } from '../types.ts'

async function expectCorrupt(path: string, raw: string): Promise<void> {
  await writeFile(path, raw, 'utf-8')
  const loaded = await loadRegistryFile(path)
  expect(loaded.ok).toBe(false)
  if (!loaded.ok) {
    expect(loaded.error.code).toBe(PW_ERROR_CODES.REGISTRY_CORRUPT)
  }
}

const sampleEntry: RegistryEntry = {
  key: {
    gitCommonDir: '/Users/x/repos/foo/.git',
    namespace: 'main',
    offsetOverride: null,
    worktreeRoot: '/Users/x/repos/foo',
  },
  lastUsedAt: '2026-05-23T17:42:11.000Z',
  namespace: 'main',
  ports: { api: 30100, vite: 30101 },
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pw-serialize-'))
})

afterEach(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('loadRegistryFile', () => {
  it('round-trips a populated registry file', async () => {
    const file: RegistryFile = { entries: [sampleEntry], version: 1 }
    const path = join(dir, 'registry.json')
    await writeFile(path, serializeRegistry(file), 'utf-8')

    const loaded = await loadRegistryFile(path)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.value).toStrictEqual(file)
    }
  })

  it('returns empty registry when file does not exist', async () => {
    const loaded = await loadRegistryFile(join(dir, 'missing.json'))
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.value).toStrictEqual({ entries: [], version: 1 })
    }
  })

  it('returns PW0302 on malformed JSON', async () => {
    await expectCorrupt(join(dir, 'corrupt.json'), '{ not json')
  })

  it('returns PW0302 when entries field is missing', async () => {
    await expectCorrupt(
      join(dir, 'bad-shape.json'),
      JSON.stringify({ version: 1 }),
    )
  })

  it('returns PW0302 when version is wrong', async () => {
    await expectCorrupt(
      join(dir, 'bad-version.json'),
      JSON.stringify({ entries: [], version: 2 }),
    )
  })

  it('returns PW0302 when a port is not an integer', async () => {
    await expectCorrupt(
      join(dir, 'bad-port.json'),
      JSON.stringify({
        entries: [{ ...sampleEntry, ports: { api: 'eighty' } }],
        version: 1,
      }),
    )
  })

  it('returns PW0302 when lastUsedAt is not an ISO date', async () => {
    await expectCorrupt(
      join(dir, 'bad-date.json'),
      JSON.stringify({
        entries: [{ ...sampleEntry, lastUsedAt: 'last tuesday' }],
        version: 1,
      }),
    )
  })

  it('returns PW0302 when key.worktreeRoot is missing', async () => {
    await expectCorrupt(
      join(dir, 'bad-key.json'),
      JSON.stringify({
        entries: [
          {
            ...sampleEntry,
            key: { gitCommonDir: null, namespace: 'main' },
          },
        ],
        version: 1,
      }),
    )
  })

  it('drops unknown top-level entry fields silently', async () => {
    const path = join(dir, 'extra.json')
    await writeFile(
      path,
      JSON.stringify({
        entries: [{ ...sampleEntry, futureField: 'ignored' }],
        version: 1,
      }),
      'utf-8',
    )
    const loaded = await loadRegistryFile(path)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      const [first] = loaded.value.entries
      expect(first).toBeDefined()
      expect('futureField' in first).toBe(false)
    }
  })

  it('accepts null gitCommonDir (non-git fallback)', async () => {
    const path = join(dir, 'no-git.json')
    const entry: RegistryEntry = {
      ...sampleEntry,
      key: {
        gitCommonDir: null,
        namespace: 'main',
        offsetOverride: null,
        worktreeRoot: '/some/dir',
      },
    }
    await writeFile(
      path,
      JSON.stringify({ entries: [entry], version: 1 }),
      'utf-8',
    )
    const loaded = await loadRegistryFile(path)
    expect(loaded.ok).toBe(true)
  })
})

describe('serializeRegistry', () => {
  it('serializes with a trailing newline and 2-space indent', () => {
    const out = serializeRegistry({ entries: [sampleEntry], version: 1 })
    expect(out.endsWith('\n')).toBe(true)
    expect(out.includes('  ')).toBe(true)
  })

  it('serialized records have no offset field (schema constraint)', () => {
    const out = serializeRegistry({ entries: [sampleEntry], version: 1 })
    expect(out.includes('offset')).toBe(false)
    const parsed = JSON.parse(out) as { entries: Record<string, unknown>[] }
    const [first] = parsed.entries
    expect(first).toBeDefined()
    expect('offset' in first).toBe(false)
  })

  it('breaks worktreeRoot ties by namespace order', () => {
    const a: RegistryEntry = {
      ...sampleEntry,
      key: {
        gitCommonDir: null,
        namespace: 'beta',
        offsetOverride: null,
        worktreeRoot: '/same',
      },
      namespace: 'beta',
    }
    const b: RegistryEntry = {
      ...sampleEntry,
      key: {
        gitCommonDir: null,
        namespace: 'alpha',
        offsetOverride: null,
        worktreeRoot: '/same',
      },
      namespace: 'alpha',
    }
    const out = serializeRegistry({ entries: [a, b], version: 1 })
    const parsed = JSON.parse(out) as { entries: { namespace: string }[] }
    expect(parsed.entries.map((e) => e.namespace)).toStrictEqual([
      'alpha',
      'beta',
    ])
  })
})

describe('loadRegistryFile edge cases', () => {
  let tmpDir2: string
  beforeEach(async () => {
    tmpDir2 = await mkdtemp(join(tmpdir(), 'pw-serialize-edge-'))
  })
  afterEach(async () => {
    await rm(tmpDir2, { force: true, recursive: true })
  })

  it('returns PW0302 when the top-level shape is not an object', async () => {
    await expectCorrupt(join(tmpDir2, 'array.json'), JSON.stringify([]))
  })

  it('returns PW0302 when entry.namespace is missing', async () => {
    const broken = { ...sampleEntry, namespace: 42 }
    await expectCorrupt(
      join(tmpDir2, 'no-ns.json'),
      JSON.stringify({ entries: [broken], version: 1 }),
    )
  })

  it('returns PW0302 when entry.key is not an object', async () => {
    await expectCorrupt(
      join(tmpDir2, 'bad-key-shape.json'),
      JSON.stringify({
        entries: [{ ...sampleEntry, key: 'string-key' }],
        version: 1,
      }),
    )
  })

  it('returns PW0302 when entry.ports is not an object', async () => {
    await expectCorrupt(
      join(tmpDir2, 'bad-ports-shape.json'),
      JSON.stringify({
        entries: [{ ...sampleEntry, ports: ['api', 30100] }],
        version: 1,
      }),
    )
  })

  it('returns PW0302 when key.gitCommonDir is the wrong type', async () => {
    await expectCorrupt(
      join(tmpDir2, 'bad-gitdir.json'),
      JSON.stringify({
        entries: [
          {
            ...sampleEntry,
            key: { gitCommonDir: 7, namespace: 'main', worktreeRoot: '/x' },
          },
        ],
        version: 1,
      }),
    )
  })

  it('returns PW0302 when an entry itself is not an object', async () => {
    await expectCorrupt(
      join(tmpDir2, 'entry-string.json'),
      JSON.stringify({ entries: ['not-an-object'], version: 1 }),
    )
  })

  it('returns PW0302 when a port number is not an integer (float)', async () => {
    await expectCorrupt(
      join(tmpDir2, 'float-port.json'),
      JSON.stringify({
        entries: [{ ...sampleEntry, ports: { api: 30100.5 } }],
        version: 1,
      }),
    )
  })

  it('wraps non-ENOENT readFile errors as PW0302', async () => {
    // A directory path triggers a read error other than ENOENT.
    const loaded = await loadRegistryFile(tmpDir2)
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) {
      expect(loaded.error.code).toBe(PW_ERROR_CODES.REGISTRY_CORRUPT)
    }
  })
})
