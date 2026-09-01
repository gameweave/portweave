import {
  PW_METADATA_FIELDS,
  PW_METADATA_PREFIX,
  RESERVED_NAMESPACE_TOKEN,
} from '../env/metadata.ts'
import {
  PLACEHOLDER_PATTERN,
  PORT_MAX,
  type RawConfigFile,
  type RawServiceEntry,
  RESERVED_ENV_PREFIX,
} from './shapes.ts'

// Rules that span more than one field, so zod cannot express them: identifier
// uniqueness across every service's envVar and discoveryEnv keys, template
// placeholders resolving to a declared service, and slot geometry (a slot is
// serviceCount ports wide, so the stride depends on the service count).

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

export function checkCrossFieldRules(raw: RawConfigFile): string[] {
  const ctx: CrossFieldContext = {
    errors: [],
    seen: new Map<string, string>(),
    serviceNames: new Set(Object.keys(raw.services)),
  }
  for (const [name, entry] of Object.entries(raw.services)) {
    recordEnvVar(name, entry, ctx)
    checkDiscoveryEnv(name, entry, ctx)
  }
  checkPool(raw, ctx)
  return ctx.errors
}

// Slot geometry depends on the service count, so it cannot live in the zod
// schema — a slot is serviceCount ports wide, and the stride has to clear it.
function checkPool(raw: RawConfigFile, ctx: CrossFieldContext): void {
  if (raw.pool === undefined) {
    return
  }
  const { basePort, primarySlot, slots, stride } = raw.pool
  const serviceCount = ctx.serviceNames.size
  if (stride < serviceCount) {
    ctx.errors.push(
      `pool.stride: must be >= the number of services (${String(serviceCount)}) so adjacent slots do not overlap`,
    )
  }
  if (primarySlot !== undefined && primarySlot >= slots) {
    ctx.errors.push(
      `pool.primarySlot: must be < pool.slots (${String(slots)}), received ${String(primarySlot)}`,
    )
  }
  const highestPort = basePort + (slots - 1) * stride + serviceCount - 1
  if (highestPort > PORT_MAX) {
    ctx.errors.push(
      `pool: the last slot would end at port ${String(highestPort)}, above the maximum ${String(PORT_MAX)}`,
    )
  }
}

function recordEnvVar(
  name: string,
  entry: RawServiceEntry,
  ctx: CrossFieldContext,
): void {
  const owner = `services.${name}.envVar`
  if (entry.envVar.startsWith(RESERVED_ENV_PREFIX)) {
    ctx.errors.push(
      `${owner}: env var "${entry.envVar}" uses the reserved "${RESERVED_ENV_PREFIX}" prefix`,
    )
  }
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
    if (envKey.startsWith(RESERVED_ENV_PREFIX)) {
      ctx.errors.push(
        `${owner}: env var "${envKey}" uses the reserved "${RESERVED_ENV_PREFIX}" prefix`,
      )
    }
    const prior = ctx.seen.get(envKey)
    if (prior !== undefined) {
      ctx.errors.push(
        `${owner}: duplicate identifier "${envKey}" already declared at ${prior}`,
      )
    } else {
      ctx.seen.set(envKey, owner)
    }
    for (const placeholder of collectPlaceholders(template)) {
      checkPlaceholder(placeholder, owner, ctx)
    }
  }
}

function checkPlaceholder(
  placeholder: string,
  owner: string,
  ctx: CrossFieldContext,
): void {
  // `${namespace}` is reserved (always the worktree namespace), so it validates
  // regardless of whether a service named "namespace" exists (decision-log #37).
  if (placeholder === RESERVED_NAMESPACE_TOKEN) {
    return
  }
  if (placeholder.startsWith(PW_METADATA_PREFIX)) {
    const field = placeholder.slice(PW_METADATA_PREFIX.length)
    if (!(PW_METADATA_FIELDS as readonly string[]).includes(field)) {
      ctx.errors.push(
        `${owner}: template references unknown metadata field "${field}"`,
      )
    }
    return
  }
  if (!ctx.serviceNames.has(placeholder)) {
    ctx.errors.push(
      `${owner}: template references unknown service "${placeholder}"`,
    )
  }
}
