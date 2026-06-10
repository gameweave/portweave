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

// The distinct declared services a discoveryEnv template references, in
// appearance order — the basis for panel link attribution (a URL belongs to
// the service it points at, wherever it is declared). Unlike evaluateTemplate
// this never throws: unknown placeholders are simply not service refs, and the
// reserved `${namespace}` token keeps its reservation — never a service ref,
// even for a service literally named "namespace" (decision-log #37).
export function referencedServiceNames(
  template: string,
  serviceNames: ReadonlySet<string>,
): readonly string[] {
  const found: string[] = []
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (
      name === RESERVED_NAMESPACE_TOKEN ||
      name.startsWith(PW_METADATA_PREFIX) ||
      !serviceNames.has(name) ||
      found.includes(name)
    ) {
      continue
    }
    found.push(name)
  }
  return found
}
