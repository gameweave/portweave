import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import type { Config, ServiceSpec } from './schema.ts'

const ANONYMOUS_COUNT_MIN = 1
const ANONYMOUS_COUNT_MAX = 100

export function synthesizeAnonymousConfig(
  count: number,
): Result<Config, PortweaveError> {
  if (
    !Number.isInteger(count) ||
    count < ANONYMOUS_COUNT_MIN ||
    count > ANONYMOUS_COUNT_MAX
  ) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CONFIG_INVALID,
        `count must be an integer in [${String(ANONYMOUS_COUNT_MIN)}, ${String(ANONYMOUS_COUNT_MAX)}], received ${String(count)}`,
      ),
    )
  }
  const services: ServiceSpec[] = []
  for (let i = 1; i <= count; i += 1) {
    services.push({
      discoveryEnv: {},
      envVar: `PORT_${String(i)}`,
      name: `port-${String(i)}`,
    })
  }
  return ok({ groups: {}, services, source: 'anonymous' })
}
