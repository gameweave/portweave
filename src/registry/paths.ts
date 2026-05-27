import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface RegistryPaths {
  readonly lockDir: string
  readonly registryDir: string
  readonly registryFile: string
}

export function resolveRegistryPath(
  env: NodeJS.ProcessEnv = process.env,
): RegistryPaths {
  const xdg = env.XDG_CONFIG_HOME
  const configHome =
    xdg && xdg.length > 0 && isAbsolute(xdg) ? xdg : join(homedir(), '.config')
  const registryDir = join(configHome, 'portweave')
  return {
    lockDir: join(registryDir, 'registry.lock'),
    registryDir,
    registryFile: join(registryDir, 'registry.json'),
  }
}
