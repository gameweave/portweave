import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRegistryPath } from '../paths.ts'

describe('resolveRegistryPath', () => {
  it('honors XDG_CONFIG_HOME when set', () => {
    const env = { XDG_CONFIG_HOME: '/tmp/custom-config' }
    const paths = resolveRegistryPath(env)
    expect(paths.registryDir).toBe('/tmp/custom-config/portweave')
    expect(paths.registryFile).toBe(
      '/tmp/custom-config/portweave/registry.json',
    )
    expect(paths.lockDir).toBe('/tmp/custom-config/portweave/registry.lock')
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const paths = resolveRegistryPath({})
    expect(paths.registryDir).toBe(join(homedir(), '.config', 'portweave'))
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is empty string', () => {
    const paths = resolveRegistryPath({ XDG_CONFIG_HOME: '' })
    expect(paths.registryDir).toBe(join(homedir(), '.config', 'portweave'))
  })

  it('lock and registry files nest under the same directory', () => {
    const paths = resolveRegistryPath({ XDG_CONFIG_HOME: '/x' })
    expect(paths.lockDir.startsWith(paths.registryDir)).toBe(true)
    expect(paths.registryFile.startsWith(paths.registryDir)).toBe(true)
  })
})
