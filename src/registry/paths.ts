import { homedir } from 'node:os'
import { join } from 'node:path'

export interface RegistryPaths {
  readonly lockDir: string
  readonly registryDir: string
  readonly registryFile: string
}

export function resolveRegistryPath(
  env: NodeJS.ProcessEnv = process.env,
): RegistryPaths {
  const configHome =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : join(homedir(), '.config')
  const registryDir = join(configHome, 'portweave')
  return {
    lockDir: join(registryDir, 'registry.lock'),
    registryDir,
    registryFile: join(registryDir, 'registry.json'),
  }
}
