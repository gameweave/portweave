import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { PW_METADATA_PREFIX } from './metadata.ts'

const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g

export function evaluateTemplate(
  template: string,
  ports: Readonly<Record<string, number>>,
  metadata: Readonly<Record<string, string>>,
): string {
  return template.replaceAll(PLACEHOLDER_PATTERN, (_, name: string) => {
    if (name.startsWith(PW_METADATA_PREFIX)) {
      const field = name.slice(PW_METADATA_PREFIX.length)
      if (!Object.hasOwn(metadata, field)) {
        throw new PortweaveError(
          PW_ERROR_CODES.ENV_BUILD_INVALID,
          `discoveryEnv template references unknown metadata field "${field}"`,
        )
      }
      return metadata[field]
    }
    if (!Object.hasOwn(ports, name)) {
      throw new PortweaveError(
        PW_ERROR_CODES.ENV_BUILD_INVALID,
        `discoveryEnv template references unknown service "${name}"`,
      )
    }
    return String(ports[name])
  })
}
