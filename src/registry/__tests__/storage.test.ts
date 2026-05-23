import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PW_ERROR_CODES } from '../../errors.ts'
import { withRegistry } from '../storage.ts'
import type { AllocationKey, RegistryEntry } from '../types.ts'

let configDir: string
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'pw-storage-'))
  env = { XDG_CONFIG_HOME: configDir }
})

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true })
})

const makeKey = (worktreeRoot: string): AllocationKey => ({
  gitCommonDir: null,
  namespace: 'main',
  worktreeRoot,
})

const makeEntry = (worktreeRoot: string): RegistryEntry => ({
  key: makeKey(worktreeRoot),
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  namespace: 'main',
  ports: { api: 30100 },
})

describe('withRegistry', () => {
  it('persists entries via upsert', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      const result = await withRegistry((handle) => {
        handle.upsert(makeEntry(root))
        return 'done'
      }, env)
      expect(result.ok).toBe(true)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      expect(existsSync(registryFile)).toBe(true)
      const contents = JSON.parse(await readFile(registryFile, 'utf-8')) as {
        entries: RegistryEntry[]
      }
      expect(contents.entries).toHaveLength(1)
      expect(contents.entries[0]?.key.worktreeRoot).toBe(root)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not rewrite the file when no mutations occur', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert(makeEntry(root))
      }, env)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      const before = (await stat(registryFile)).mtimeMs
      await new Promise((r) => setTimeout(r, 20))
      const result = await withRegistry((h) => {
        // Pure read.
        expect(h.entries).toHaveLength(1)
      }, env)
      expect(result.ok).toBe(true)
      const after = (await stat(registryFile)).mtimeMs
      expect(after).toBe(before)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('touch updates lastUsedAt without changing ports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert(makeEntry(root))
      }, env)
      await new Promise((r) => setTimeout(r, 5))
      await withRegistry((h) => {
        h.touch(makeKey(root))
      }, env)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      const data = JSON.parse(await readFile(registryFile, 'utf-8')) as {
        entries: RegistryEntry[]
      }
      const [entry] = data.entries
      expect(entry).toBeDefined()
      expect(entry.lastUsedAt).not.toBe('2026-01-01T00:00:00.000Z')
      expect(entry.ports).toStrictEqual({ api: 30100 })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('remove drops an entry by key', async () => {
    const root1 = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    const root2 = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert(makeEntry(root1))
        h.upsert(makeEntry(root2))
      }, env)
      await withRegistry((h) => {
        h.remove(makeKey(root1))
      }, env)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      const data = JSON.parse(await readFile(registryFile, 'utf-8')) as {
        entries: RegistryEntry[]
      }
      expect(data.entries).toHaveLength(1)
      expect(data.entries[0]?.key.worktreeRoot).toBe(root2)
    } finally {
      await rm(root1, { force: true, recursive: true })
      await rm(root2, { force: true, recursive: true })
    }
  })

  it('prunes entries whose worktreeRoot has disappeared on the next mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    const root2 = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert(makeEntry(root))
        h.upsert(makeEntry(root2))
      }, env)
      await rm(root, { force: true, recursive: true })
      await withRegistry((h) => {
        // Trigger a mutation so the prune is persisted.
        h.touch(makeKey(root2))
      }, env)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      const data = JSON.parse(await readFile(registryFile, 'utf-8')) as {
        entries: RegistryEntry[]
      }
      expect(data.entries.map((e) => e.key.worktreeRoot)).toStrictEqual([root2])
    } finally {
      await rm(root2, { force: true, recursive: true }).catch(() => undefined)
    }
  })

  it('exposes entries as readonly snapshot inside fn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert(makeEntry(root))
      }, env)
      await withRegistry((h) => {
        expect(h.entries).toHaveLength(1)
        expect(h.entries[0]?.key.worktreeRoot).toBe(root)
      }, env)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('propagates the value returned by fn through the Result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      const result = await withRegistry((h) => {
        h.upsert(makeEntry(root))
        return { entries: h.entries.length }
      }, env)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toStrictEqual({ entries: 1 })
      }
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('withRegistry edge cases', () => {
  it('touch on a missing key is a no-op (no rewrite)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert(makeEntry(root))
      }, env)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      const before = (await stat(registryFile)).mtimeMs
      await new Promise((r) => setTimeout(r, 20))
      await withRegistry((h) => {
        h.touch(makeKey('/never/seen'))
      }, env)
      const after = (await stat(registryFile)).mtimeMs
      expect(after).toBe(before)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('upsert replaces an existing entry by key (no duplicates)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pw-storage-wt-'))
    try {
      await withRegistry((h) => {
        h.upsert({ ...makeEntry(root), ports: { api: 30100 } })
      }, env)
      await withRegistry((h) => {
        h.upsert({ ...makeEntry(root), ports: { api: 40000, vite: 40001 } })
      }, env)
      const registryFile = join(configDir, 'portweave', 'registry.json')
      const data = JSON.parse(await readFile(registryFile, 'utf-8')) as {
        entries: RegistryEntry[]
      }
      expect(data.entries).toHaveLength(1)
      expect(data.entries[0].ports).toStrictEqual({ api: 40000, vite: 40001 })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('returns PW0302 when the existing registry file is corrupt', async () => {
    const registryDir = join(configDir, 'portweave')
    await mkdir(registryDir, { recursive: true })
    await writeFile(
      join(registryDir, 'registry.json'),
      '{ broken json',
      'utf-8',
    )
    const result = await withRegistry(() => 'ignored', env)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PW_ERROR_CODES.REGISTRY_CORRUPT)
    }
  })

  it('returns PW0301 when the lock cannot be acquired in time', async () => {
    const registryDir = join(configDir, 'portweave')
    await mkdir(registryDir, { recursive: true })
    await mkdir(join(registryDir, 'registry.lock'))
    process.env.PORTWEAVE_LOCK_TIMEOUT_MS = '50'
    try {
      const result = await withRegistry(() => 0, env)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe(PW_ERROR_CODES.REGISTRY_LOCKED)
      }
    } finally {
      delete process.env.PORTWEAVE_LOCK_TIMEOUT_MS
      await rm(join(registryDir, 'registry.lock'), {
        force: true,
        recursive: true,
      })
    }
  })
})
