import type { z } from 'zod'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { checkCrossFieldRules } from './cross-field.ts'
import {
  configFileSchema,
  ENV_AUTHORITY_DEFAULT,
  type EnvAuthority,
  type RawConfigFile,
} from './shapes.ts'

export { ENV_AUTHORITY_DEFAULT, PORT_PRIVILEGED_FLOOR } from './shapes.ts'

export interface PoolSpec {
  basePort: number
  mode: 'slots'
  primarySlot: number
  slots: number
  stride: number
}

export interface ServiceSpec {
  discoveryEnv: Record<string, string>
  envVar: string
  group?: string
  name: string
  preferred?: number
}

export interface Config {
  envAuthority: EnvAuthority
  groups: Record<string, string[]>
  pool?: PoolSpec
  projectName?: string
  services: ServiceSpec[]
  source: 'anonymous' | 'file'
  sourcePath?: string
}

export interface NormalizationContext {
  source: 'anonymous' | 'file'
  sourcePath?: string
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    .join('\n')
}

// SERVICE_NAME_PATTERN (^[a-z][a-z0-9-]*$) is load-bearing for stable service
// ordering: V8 reorders purely-numeric keys ahead of other keys, so requiring
// names to start with [a-z] ensures JSON.parse insertion-order is preserved.
function normalize(raw: RawConfigFile, ctx: NormalizationContext): Config {
  const services: ServiceSpec[] = Object.entries(raw.services).map(
    ([name, entry]) => ({
      discoveryEnv: entry.discoveryEnv ?? {},
      envVar: entry.envVar,
      ...(entry.group !== undefined ? { group: entry.group } : {}),
      name,
      ...(entry.preferred !== undefined ? { preferred: entry.preferred } : {}),
    }),
  )

  const groups: Record<string, string[]> = {}
  for (const service of services) {
    if (service.group !== undefined) {
      const bucket = groups[service.group] ?? []
      bucket.push(service.name)
      groups[service.group] = bucket
    }
  }

  return {
    envAuthority: raw.envAuthority ?? ENV_AUTHORITY_DEFAULT,
    groups,
    ...(raw.pool !== undefined
      ? {
          pool: {
            basePort: raw.pool.basePort,
            mode: raw.pool.mode,
            primarySlot: raw.pool.primarySlot ?? 0,
            slots: raw.pool.slots,
            stride: raw.pool.stride,
          },
        }
      : {}),
    ...(raw.projectName !== undefined ? { projectName: raw.projectName } : {}),
    services,
    source: ctx.source,
    ...(ctx.sourcePath !== undefined ? { sourcePath: ctx.sourcePath } : {}),
  }
}

// `preferred` has never been read by the allocator — schema/v1.json has always
// described it as advisory. Slot mode is the real answer to "I need to know
// which ports this can land on", so warn rather than silently accept, and keep
// accepting it so an existing config does not start failing PW0102.
function warnDeprecatedPreferred(
  raw: RawConfigFile,
  stderr: { write: (msg: string) => boolean },
): void {
  const named = Object.entries(raw.services)
    .filter(([, entry]) => entry.preferred !== undefined)
    .map(([name]) => name)
  if (named.length === 0) {
    return
  }
  stderr.write(
    `[portweave] "preferred" is ignored and will be removed in 0.9 (set on: ${named.join(', ')}) — use "pool": { "mode": "slots", ... } for a deterministic, enumerable port set\n`,
  )
}

export function validateAndNormalizeConfig(
  input: unknown,
  ctx: NormalizationContext,
  stderr: { write: (msg: string) => boolean } = process.stderr,
): Result<Config, PortweaveError> {
  const parsed = configFileSchema.safeParse(input)
  if (!parsed.success) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CONFIG_INVALID,
        formatZodIssues(parsed.error),
      ),
    )
  }
  const crossFieldErrors = checkCrossFieldRules(parsed.data)
  if (crossFieldErrors.length > 0) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CONFIG_INVALID,
        crossFieldErrors.join('\n'),
      ),
    )
  }
  warnDeprecatedPreferred(parsed.data, stderr)
  return ok(normalize(parsed.data, ctx))
}
