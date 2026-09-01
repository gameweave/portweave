import { z } from 'zod'

// Raw zod shapes for portweave.config.json, plus the constants they share with
// the allocator. Split out of schema.ts so the validator, the cross-field rules
// and the normalizer can all depend on the shapes without depending on each
// other.

const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/
export const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g
const PORT_MIN = 1
export const PORT_MAX = 65535
// Ports below 1024 are privileged on POSIX (require root to bind). Allocating
// into that range would hand the dev server a port it cannot bind, so both the
// config validator and the allocator's pool parser reject the same floor.
export const PORT_PRIVILEGED_FLOOR = 1024
// Reserved for Portweave's own injected output vars (e.g. PORTWEAVE_NAMESPACE);
// a user envVar/discoveryEnv key here would collide with what `run` injects.
export const RESERVED_ENV_PREFIX = 'PORTWEAVE_'

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

// Which layer wins when the project `.env` names a key Portweave also computes.
// `dotenv` (the default) preserves the original contract: an explicit `.env`
// entry pins the value. `portweave` inverts it for projects whose `.env` is
// shared across worktrees — a symlinked monorepo `.env` cannot carry a
// per-worktree port, so letting it win makes the allocation inert. The parent
// process env still beats both either way (see run.ts).
export const ENV_AUTHORITY_DEFAULT = 'dotenv'
const envAuthoritySchema = z.enum(['dotenv', 'portweave'])

// Slot mode trades first-fit density for a finite, enumerable port set: slot i
// occupies [basePort + i*stride, ... + serviceCount - 1]. That enumerability is
// the whole point — OAuth providers cannot wildcard a localhost port, so the
// candidate URLs have to be listable up front to be pre-registered.
const poolSchema = z.strictObject({
  basePort: z
    .int('pool.basePort must be an integer')
    .min(
      PORT_PRIVILEGED_FLOOR,
      `pool.basePort must be >= ${String(PORT_PRIVILEGED_FLOOR)}`,
    )
    .max(PORT_MAX, `pool.basePort must be <= ${String(PORT_MAX)}`),
  mode: z.literal('slots'),
  primarySlot: z
    .int('pool.primarySlot must be an integer')
    .min(0, 'pool.primarySlot must be >= 0')
    .optional(),
  slots: z
    .int('pool.slots must be an integer')
    .min(1, 'pool.slots must be >= 1'),
  stride: z
    .int('pool.stride must be an integer')
    .min(1, 'pool.stride must be >= 1'),
})

export const configFileSchema = z.strictObject({
  $schema: z.string().optional(),
  envAuthority: envAuthoritySchema.optional(),
  pool: poolSchema.optional(),
  projectName: z.string().trim().min(1).max(100).optional(),
  services: servicesMapSchema,
})

export type RawServiceEntry = z.infer<typeof serviceEntrySchema>
export type RawConfigFile = z.infer<typeof configFileSchema>

export type EnvAuthority = z.infer<typeof envAuthoritySchema>
