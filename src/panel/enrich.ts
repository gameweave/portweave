import { existsSync } from 'node:fs'
import { type Config, loadConfig } from '../config/index.ts'
import { buildEnvMap } from '../env/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { readRegistryEntries } from '../registry/storage.ts'
import type { RegistryEntry } from '../registry/types.ts'
import { DEFAULT_TRIAGE, stampTriage } from './enrich-triage.ts'
import { resolveLabel } from './labels.ts'
import { probePortAlive } from './liveness.ts'
import { attributeLinks, resolveServiceLinks } from './service-links.ts'
import { compareProjects, compareWorktrees } from './sort.ts'
import type { TriageProvider, WorktreeTriage } from './triage-cache.ts'
import type {
  PanelLivenessStatus,
  PanelProject,
  PanelService,
  PanelSnapshot,
  PanelWorktree,
} from './types.ts'

const DEGRADED = {
  configInvalid: 'config invalid',
  configMissing: 'config missing',
  directoryDeleted: 'directory deleted',
} as const

type StatusByPort = ReadonlyMap<number, PanelLivenessStatus>

// Public worktree plus grouping/labeling fields, dropped before the snapshot.
interface EnrichedWorktree {
  readonly gitCommonDir: null | string
  readonly projectName: null | string
  readonly worktree: PanelWorktree
}

export interface EnrichDeps {
  forceTriage?: boolean
  probe?: (port: number) => Promise<PanelLivenessStatus>
  triage?: TriageProvider
}

export async function buildPanelSnapshot(
  env: NodeJS.ProcessEnv,
  deps?: EnrichDeps,
): Promise<PanelSnapshot> {
  const probe = deps?.probe ?? probePortAlive

  const entriesResult = await readRegistryEntries(env)
  if (!entriesResult.ok) {
    throw entriesResult.error
  }
  const entries = entriesResult.value

  const statusByPort = await probeAllPorts(entries, probe)
  const { forceTriage, triage } = deps ?? {}
  const enriched = await Promise.all(
    entries.map((e) => enrichEntry(e, statusByPort, triage, forceTriage)),
  )

  return {
    generatedAt: new Date().toISOString(),
    launchSupported: process.platform === 'darwin',
    projects: groupIntoProjects(enriched),
    prStatusAvailable: triage?.prStatusAvailable ?? false,
  }
}

// One parallel probe batch over every entry's ports, so all paths resolve in ~one timeout.
async function probeAllPorts(
  entries: readonly RegistryEntry[],
  probe: (port: number) => Promise<PanelLivenessStatus>,
): Promise<StatusByPort> {
  const ports = [
    ...new Set(entries.flatMap((entry) => Object.values(entry.ports))),
  ]
  const statuses = await Promise.all(ports.map((port) => probe(port)))
  const byPort = new Map<number, PanelLivenessStatus>()
  for (const [index, port] of ports.entries()) {
    byPort.set(port, statuses[index])
  }
  return byPort
}

// Never throws: config/env failures become the degraded shape (one bad entry
// must never break the whole page). Triage is fetched once up front (default
// when no provider is injected) so both the healthy and degraded paths stamp it.
async function enrichEntry(
  entry: RegistryEntry,
  statusByPort: StatusByPort,
  provider?: TriageProvider,
  force?: boolean,
): Promise<EnrichedWorktree> {
  const triage = provider
    ? await provider.triageFor(entry.key.worktreeRoot, force)
    : DEFAULT_TRIAGE

  if (!existsSync(entry.key.worktreeRoot)) {
    return degraded(entry, DEGRADED.directoryDeleted, statusByPort, triage)
  }

  const configResult = await loadConfig(entry.key.worktreeRoot)
  if (!configResult.ok) {
    const reason =
      configResult.error.code === PW_ERROR_CODES.CONFIG_MISSING
        ? DEGRADED.configMissing
        : DEGRADED.configInvalid
    return degraded(entry, reason, statusByPort, triage)
  }

  try {
    const envMap = buildEnvMap(entry, configResult.value)
    return healthy({
      config: configResult.value,
      entry,
      envMap,
      statusByPort,
      triage,
    })
  } catch (caught: unknown) {
    if (
      caught instanceof PortweaveError &&
      caught.code === PW_ERROR_CODES.ENV_BUILD_INVALID
    ) {
      return degraded(entry, DEGRADED.configInvalid, statusByPort, triage)
    }
    throw caught
  }
}

function healthy(args: {
  config: Config
  entry: RegistryEntry
  envMap: Record<string, string>
  statusByPort: StatusByPort
  triage: WorktreeTriage
}): EnrichedWorktree {
  const { config, entry, envMap, statusByPort, triage } = args
  const linksByService = attributeLinks(config, envMap)
  const services: PanelService[] = config.services.map((service) => {
    const port = entry.ports[service.name]
    return {
      envVar: service.envVar,
      links: resolveServiceLinks(linksByService.get(service.name) ?? [], port),
      name: service.name,
      port,
      status: statusByPort.get(port) ?? 'unknown',
    }
  })

  return wrap(entry, config.projectName ?? null, triage, {
    degraded: false,
    degradedReason: null,
    services,
  })
}

function degraded(
  entry: RegistryEntry,
  reason: string,
  statusByPort: StatusByPort,
  triage: WorktreeTriage,
): EnrichedWorktree {
  const services: PanelService[] = Object.entries(entry.ports)
    .map(([name, port]) => ({
      envVar: '',
      links: resolveServiceLinks([], port),
      name,
      port,
      status: statusByPort.get(port) ?? 'unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return wrap(entry, null, triage, {
    degraded: true,
    degradedReason: reason,
    services,
  })
}

type WorktreeCore = Pick<
  PanelWorktree,
  'degraded' | 'degradedReason' | 'services'
>

function wrap(
  entry: RegistryEntry,
  projectName: null | string,
  triage: WorktreeTriage,
  core: WorktreeCore,
): EnrichedWorktree {
  return {
    gitCommonDir: entry.key.gitCommonDir,
    projectName,
    worktree: {
      ...core,
      ...stampTriage(triage, entry.key.worktreeRoot),
      lastUsedAt: entry.lastUsedAt,
      namespace: entry.key.namespace,
      worktreeRoot: entry.key.worktreeRoot,
    },
  }
}

function groupIntoProjects(
  enriched: readonly EnrichedWorktree[],
): PanelProject[] {
  const buckets = new Map<string, EnrichedWorktree[]>()
  for (const item of enriched) {
    const key = item.gitCommonDir ?? ''
    const bucket = buckets.get(key) ?? []
    bucket.push(item)
    buckets.set(key, bucket)
  }

  return [...buckets.values()].map(buildProject).sort(compareProjects)
}

function buildProject(bucket: EnrichedWorktree[]): PanelProject {
  const sorted = [...bucket].sort((a, b) =>
    compareWorktrees(a.worktree, b.worktree),
  )
  const gitCommonDir = sorted[0].gitCommonDir
  return {
    gitCommonDir,
    label: resolveLabel(sorted, gitCommonDir),
    worktrees: sorted.map((item) => item.worktree),
  }
}
