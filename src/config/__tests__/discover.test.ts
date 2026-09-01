import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ports } from '../../runtime/index.ts'
import { setupScopedXdg } from '../../runtime/__tests__/_helpers.ts'
import { findConfigUpward } from '../discover.ts'

setupScopedXdg()

async function makeTmpDir(label: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `portweave-upwalk-test-${label}-${process.pid.toString()}-${Date.now().toString()}`,
  )
  await mkdir(dir, { recursive: true })
  return dir
}

const VALID_CONFIG = JSON.stringify({
  services: { svc: { envVar: 'SVC_PORT' } },
})

describe('findConfigUpward', () => {
  it('finds config when called from depth 0 (same dir as config)', async () => {
    const dir = await makeTmpDir('depth0')
    await writeFile(join(dir, 'portweave.config.json'), VALID_CONFIG)
    const result = await ports({ cwd: dir })
    expect(result.ok).toBe(true)
  })

  it('finds config when called from depth 1', async () => {
    const root = await makeTmpDir('depth1')
    await writeFile(join(root, 'portweave.config.json'), VALID_CONFIG)
    const sub = join(root, 'level1')
    await mkdir(sub, { recursive: true })
    const result = await ports({ cwd: sub })
    expect(result.ok).toBe(true)
  })

  it('finds config when called from depth 2', async () => {
    const root = await makeTmpDir('depth2')
    await writeFile(join(root, 'portweave.config.json'), VALID_CONFIG)
    const sub = join(root, 'level1', 'level2')
    await mkdir(sub, { recursive: true })
    const result = await ports({ cwd: sub })
    expect(result.ok).toBe(true)
  })

  it('finds config when called from depth 3', async () => {
    const root = await makeTmpDir('depth3')
    await writeFile(join(root, 'portweave.config.json'), VALID_CONFIG)
    const sub = join(root, 'level1', 'level2', 'level3')
    await mkdir(sub, { recursive: true })
    const result = await ports({ cwd: sub })
    expect(result.ok).toBe(true)
  })

  it('returns err (not null/crash) when no config exists at any ancestor', async () => {
    const isolated = await makeTmpDir('no-config-anywhere')
    // No portweave.config.json created — walk will exhaust at the tmp root
    // and return null, triggering RUNTIME_CONFIG_NOT_FOUND.
    const result = await ports({ cwd: isolated })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    // Either no-config-found or RUNTIME_CONFIG_NOT_FOUND depending on whether
    // a parent dir happens to have a config. We just verify it is a typed error.
    expect(result.error.code).toBeDefined()
  })

  // chmod 000 doesn't restrict root on POSIX. Skip when running as root
  // (Docker / some CI configurations) so the assertion remains meaningful.
  const runningAsRoot = process.getuid?.() === 0

  it.skipIf(runningAsRoot)(
    'rethrows non-ENOENT errors (e.g. EACCES) instead of silently treating them as missing',
    async () => {
      const dir = await makeTmpDir('eacces-rethrow')
      await writeFile(join(dir, 'portweave.config.json'), VALID_CONFIG)
      // Strip all permissions on the directory so fs.access for the
      // config file fails with EACCES rather than ENOENT.
      await chmod(dir, 0o000)
      let caught: unknown
      try {
        await findConfigUpward(dir)
      } catch (e: unknown) {
        caught = e
      } finally {
        // Restore permissions so the temp dir can be cleaned up later.
        await chmod(dir, 0o700)
      }
      expect(caught).toBeInstanceOf(Error)
      if (caught instanceof Error) {
        expect('code' in caught ? (caught as { code: unknown }).code : '').toBe(
          'EACCES',
        )
      }
    },
  )

  it('uses nearest ancestor config when multiple exist in the tree', async () => {
    const outer = await makeTmpDir('multi-config-outer')
    const outerConfig = JSON.stringify({
      services: { outer: { envVar: 'OUTER_PORT' } },
    })
    const innerConfig = JSON.stringify({
      services: { inner: { envVar: 'INNER_PORT' } },
    })
    await writeFile(join(outer, 'portweave.config.json'), outerConfig)
    const inner = join(outer, 'sub')
    await mkdir(inner, { recursive: true })
    await writeFile(join(inner, 'portweave.config.json'), innerConfig)
    // cwd=inner → nearest config is the one in inner
    const result = await ports({ cwd: inner })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    // inner config has 'inner' service, not 'outer'
    expect(Object.keys(result.value)).toContain('inner')
    expect(Object.keys(result.value)).not.toContain('outer')
  })
})
