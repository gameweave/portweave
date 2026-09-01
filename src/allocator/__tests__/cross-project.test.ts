import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocate } from '../allocate.ts'
import type { AllocationKey } from '../../registry/types.ts'
import { addWorktreeDir, cleanupTempDirs, makeTempDirs } from './_helpers.ts'
import type { TempDirs } from './_helpers.ts'

let dirs: TempDirs

beforeEach(async () => {
  dirs = await makeTempDirs()
})

afterEach(async () => {
  await cleanupTempDirs(dirs)
})

function makeKey(
  gitCommonDir: null | string,
  worktreeRoot: string,
  namespace: string,
): AllocationKey {
  return {
    gitCommonDir,
    namespace,
    offsetOverride: null,
    worktreeRoot,
  }
}

function makeConfig(serviceNames: string[]) {
  return {
    envAuthority: 'dotenv' as const,
    groups: {},
    services: serviceNames.map((name) => ({
      discoveryEnv: {},
      envVar: `${name.toUpperCase()}_PORT`,
      name,
    })),
    source: 'anonymous' as const,
  }
}

describe('cross-project collision protection', () => {
  it('two distinct repos with overlapping service names get non-overlapping port sets', async () => {
    // Simulate two repos: foo and bar — both declare 'api' and 'vite'
    const fooRoot = await addWorktreeDir(dirs)
    const barRoot = await addWorktreeDir(dirs)
    const keyFoo = makeKey('/repos/foo/.git', fooRoot, 'main')
    const keyBar = makeKey('/repos/bar/.git', barRoot, 'main')

    const config = makeConfig(['api', 'vite'])
    const xdgEnv = { XDG_CONFIG_HOME: dirs.configDir }

    const resultFoo = await allocate(keyFoo, config, xdgEnv)
    const resultBar = await allocate(keyBar, config, xdgEnv)

    expect(resultFoo.ok).toBe(true)
    expect(resultBar.ok).toBe(true)
    if (!resultFoo.ok || !resultBar.ok) {
      return
    }

    const fooSet = new Set(Object.values(resultFoo.value.allocation.ports))
    const barSet = new Set(Object.values(resultBar.value.allocation.ports))

    for (const port of barSet) {
      expect(fooSet.has(port)).toBe(false)
    }
  })

  it('same repo, different worktrees also get non-overlapping port sets', async () => {
    const mainRoot = await addWorktreeDir(dirs)
    const featureRoot = await addWorktreeDir(dirs)
    const commonDir = join(dirs.configDir, 'fake-repo.git')
    const keyMain = makeKey(commonDir, mainRoot, 'main')
    const keyFeature = makeKey(commonDir, featureRoot, 'feature-x-abc')

    const config = makeConfig(['api', 'vite', 'ws'])
    const xdgEnv = { XDG_CONFIG_HOME: dirs.configDir }

    const resultMain = await allocate(keyMain, config, xdgEnv)
    const resultFeature = await allocate(keyFeature, config, xdgEnv)

    expect(resultMain.ok).toBe(true)
    expect(resultFeature.ok).toBe(true)
    if (!resultMain.ok || !resultFeature.ok) {
      return
    }

    const mainSet = new Set(Object.values(resultMain.value.allocation.ports))
    const featureSet = new Set(
      Object.values(resultFeature.value.allocation.ports),
    )

    for (const port of featureSet) {
      expect(mainSet.has(port)).toBe(false)
    }
  })
})
