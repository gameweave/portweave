import type { Config } from '../config/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import type { Allocation } from '../allocator/allocate.ts'
import { buildMetadata, PORTWEAVE_NAMESPACE_VAR } from './metadata.ts'
import { evaluateTemplate } from './templates.ts'

export function buildEnvMap(
  allocation: Allocation,
  config: Config,
): Record<string, string> {
  const metadata = buildMetadata(allocation)
  const result: Record<string, string> = {
    [PORTWEAVE_NAMESPACE_VAR]: metadata.namespace,
  }

  for (const service of config.services) {
    if (!Object.hasOwn(allocation.ports, service.name)) {
      throw new PortweaveError(
        PW_ERROR_CODES.ENV_BUILD_INVALID,
        `service "${service.name}" has no port in the allocation — config/allocation drift detected`,
      )
    }
    const port = allocation.ports[service.name]
    result[service.envVar] = String(port)

    for (const [discoveryKey, template] of Object.entries(
      service.discoveryEnv,
    )) {
      result[discoveryKey] = evaluateTemplate(
        template,
        allocation.ports,
        metadata,
      )
    }
  }

  return result
}
