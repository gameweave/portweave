import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'

const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g

export function evaluateTemplate(
  template: string,
  ports: Readonly<Record<string, number>>,
): string {
  return template.replaceAll(PLACEHOLDER_PATTERN, (_, name: string) => {
    if (!Object.hasOwn(ports, name)) {
      throw new PortweaveError(
        PW_ERROR_CODES.ENV_BUILD_INVALID,
        `discoveryEnv template references unknown service "${name}"`,
      )
    }
    return String(ports[name])
  })
}
