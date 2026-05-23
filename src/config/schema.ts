import { z } from 'zod'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'

const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/
const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g
const PORT_MIN = 1
const PORT_MAX = 65535

const envVarSchema = z
  .string()
  .regex(ENV_VAR_PATTERN, 'envVar must match /^[A-Z][A-Z0-9_]*$/')

const discoveryEnvSchema = z.record(envVarSchema, z.string())

const serviceEntrySchema = z.strictObject({
  discoveryEnv: discoveryEnvSchema.optional(),
  envVar: envVarSchema,
  group: z.string().min(1, 'group must be a non-empty string').optional(),
  preferred: z
    .int('preferred must be an integer')
    .min(PORT_MIN, `preferred must be >= ${String(PORT_MIN)}`)
    .max(PORT_MAX, `preferred must be <= ${String(PORT_MAX)}`)
    .optional(),
})

const servicesMapSchema = z
  .record(
    z.string().regex(SERVICE_NAME_PATTERN, 'service name must be kebab-case'),
    serviceEntrySchema,
  )
  .refine((value) => Object.keys(value).length > 0, {
    error: 'services must contain at least one entry',
  })

const configFileSchema = z.strictObject({
  $schema: z.string().optional(),
  services: servicesMapSchema,
})

type RawServiceEntry = z.infer<typeof serviceEntrySchema>
type RawConfigFile = z.infer<typeof configFileSchema>

export interface ServiceSpec {
  discoveryEnv: Record<string, string>
  envVar: string
  group?: string
  name: string
  preferred?: number
}

export interface Config {
  groups: Record<string, string[]>
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

function collectPlaceholders(value: string): string[] {
  const found: string[] = []
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    found.push(match[1])
  }
  return found
}

interface CrossFieldContext {
  errors: string[]
  seen: Map<string, string>
  serviceNames: Set<string>
}

function checkCrossFieldRules(raw: RawConfigFile): string[] {
  const ctx: CrossFieldContext = {
    errors: [],
    seen: new Map<string, string>(),
    serviceNames: new Set(Object.keys(raw.services)),
  }
  for (const [name, entry] of Object.entries(raw.services)) {
    recordEnvVar(name, entry, ctx)
    checkDiscoveryEnv(name, entry, ctx)
  }
  return ctx.errors
}

function recordEnvVar(
  name: string,
  entry: RawServiceEntry,
  ctx: CrossFieldContext,
): void {
  const owner = `services.${name}.envVar`
  const prior = ctx.seen.get(entry.envVar)
  if (prior !== undefined) {
    ctx.errors.push(
      `${owner}: duplicate identifier "${entry.envVar}" already declared at ${prior}`,
    )
    return
  }
  ctx.seen.set(entry.envVar, owner)
}

function checkDiscoveryEnv(
  name: string,
  entry: RawServiceEntry,
  ctx: CrossFieldContext,
): void {
  if (entry.discoveryEnv === undefined) {
    return
  }
  for (const [envKey, template] of Object.entries(entry.discoveryEnv)) {
    const owner = `services.${name}.discoveryEnv.${envKey}`
    const prior = ctx.seen.get(envKey)
    if (prior !== undefined) {
      ctx.errors.push(
        `${owner}: duplicate identifier "${envKey}" already declared at ${prior}`,
      )
    } else {
      ctx.seen.set(envKey, owner)
    }
    for (const placeholder of collectPlaceholders(template)) {
      if (!ctx.serviceNames.has(placeholder)) {
        ctx.errors.push(
          `${owner}: template references unknown service "${placeholder}"`,
        )
      }
    }
  }
}

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
    groups,
    services,
    source: ctx.source,
    ...(ctx.sourcePath !== undefined ? { sourcePath: ctx.sourcePath } : {}),
  }
}

export function validateAndNormalizeConfig(
  input: unknown,
  ctx: NormalizationContext,
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
  return ok(normalize(parsed.data, ctx))
}
