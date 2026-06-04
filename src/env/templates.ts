import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { PW_METADATA_PREFIX, RESERVED_NAMESPACE_TOKEN } from './metadata.ts'

const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g

function resolveMetadataField(
  field: string,
  metadata: Readonly<Record<string, string>>,
): string {
  if (!Object.hasOwn(metadata, field)) {
    throw new PortweaveError(
      PW_ERROR_CODES.ENV_BUILD_INVALID,
      `discoveryEnv template references unknown metadata field "${field}"`,
    )
  }
  return metadata[field]
}

export function evaluateTemplate(
  template: string,
  ports: Readonly<Record<string, number>>,
  metadata: Readonly<Record<string, string>>,
): string {
  return template.replaceAll(PLACEHOLDER_PATTERN, (_, name: string) => {
    // `${namespace}` is reserved — it always resolves to the worktree namespace,
    // shadowing any service literally named "namespace". Checked first, before
    // the service-port lookup, so the reservation always wins (decision-log #37).
    if (name === RESERVED_NAMESPACE_TOKEN) {
      return resolveMetadataField(RESERVED_NAMESPACE_TOKEN, metadata)
    }
    if (name.startsWith(PW_METADATA_PREFIX)) {
      return resolveMetadataField(
        name.slice(PW_METADATA_PREFIX.length),
        metadata,
      )
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
