import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { type Config, loadConfig } from '../config/index.ts'
import { buildEnvMap } from '../env/index.ts'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { readRegistryEntries } from '../registry/storage.ts'
import type { RegistryEntry } from '../registry/types.ts'
import { MAIN_NAMESPACE } from '../worktree/namespace.ts'
import { probePortAlive } from './liveness.ts'
import type {
  PanelLink,
  PanelLivenessStatus,
  PanelProject,
  PanelService,
  PanelSnapshot,
  PanelWorktree,
} from './types.ts'

const NO_REPO_LABEL = '(no repo)'
const GIT_SUFFIX = '.git'

// Clickable-link scheme allowlist (XSS guard): a discoveryEnv resolving to
// `javascript:`/`data:`/a DB URL is dropped here but still injected as env.
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])
const isSafeLinkUrl = (value: string): boolean =>
  URL.canParse(value) && SAFE_LINK_SCHEMES.has(new URL(value).protocol)

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
  probe?: (port: number) => Promise<PanelLivenessStatus>
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
  const enriched = await Promise.all(
    entries.map((entry) => enrichEntry(entry, statusByPort)),
  )

  return {
    generatedAt: new Date().toISOString(),
    projects: groupIntoProjects(enriched),
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
// must never break the whole page).
async function enrichEntry(
  entry: RegistryEntry,
  statusByPort: StatusByPort,
): Promise<EnrichedWorktree> {
  if (!existsSync(entry.key.worktreeRoot)) {
    return degraded(entry, DEGRADED.directoryDeleted, statusByPort)
  }

  const configResult = await loadConfig(entry.key.worktreeRoot)
  if (!configResult.ok) {
    const reason =
      configResult.error.code === PW_ERROR_CODES.CONFIG_MISSING
        ? DEGRADED.configMissing
        : DEGRADED.configInvalid
    return degraded(entry, reason, statusByPort)
  }

  try {
    const envMap = buildEnvMap(entry, configResult.value)
    return healthy(entry, configResult.value, envMap, statusByPort)
  } catch (caught: unknown) {
    if (
      caught instanceof PortweaveError &&
      caught.code === PW_ERROR_CODES.ENV_BUILD_INVALID
    ) {
      return degraded(entry, DEGRADED.configInvalid, statusByPort)
    }
    throw caught
  }
}

function healthy(
  entry: RegistryEntry,
  config: Config,
  envMap: Record<string, string>,
  statusByPort: StatusByPort,
): EnrichedWorktree {
  const services: PanelService[] = config.services.map((service) => {
    const links: PanelLink[] = Object.keys(service.discoveryEnv)
      .map((key) => ({ envVar: key, url: envMap[key] }))
      .filter((link) => isSafeLinkUrl(link.url))
    const port = entry.ports[service.name]
    return {
      envVar: service.envVar,
      links,
      name: service.name,
      port,
      status: statusByPort.get(port) ?? 'unknown',
    }
  })

  return wrap(entry, config.projectName ?? null, {
    degraded: false,
    degradedReason: null,
    services,
  })
}

function degraded(
  entry: RegistryEntry,
  reason: string,
  statusByPort: StatusByPort,
): EnrichedWorktree {
  const services: PanelService[] = Object.entries(entry.ports)
    .map(([name, port]) => ({
      envVar: '',
      links: [],
      name,
      port,
      status: statusByPort.get(port) ?? 'unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return wrap(entry, null, { degraded: true, degradedReason: reason, services })
}

type WorktreeCore = Pick<
  PanelWorktree,
  'degraded' | 'degradedReason' | 'services'
>

function wrap(
  entry: RegistryEntry,
  projectName: null | string,
  core: WorktreeCore,
): EnrichedWorktree {
  return {
    gitCommonDir: entry.key.gitCommonDir,
    projectName,
    worktree: {
      ...core,
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
    a.worktree.namespace.localeCompare(b.worktree.namespace),
  )
  const gitCommonDir = sorted[0].gitCommonDir
  return {
    gitCommonDir,
    label: resolveLabel(sorted, gitCommonDir),
    worktrees: sorted.map((item) => item.worktree),
  }
}

// Explicit projectName wins (main-namespace config first, else first non-empty
// by namespace sort); else derived from gitCommonDir; else '(no repo)'.
function resolveLabel(
  sorted: readonly EnrichedWorktree[],
  gitCommonDir: null | string,
): string {
  const mainName =
    sorted.find((item) => item.worktree.namespace === MAIN_NAMESPACE)
      ?.projectName ?? null
  const firstName =
    sorted.find((item) => item.projectName !== null)?.projectName ?? null
  return mainName ?? firstName ?? deriveLabel(gitCommonDir)
}

function deriveLabel(gitCommonDir: null | string): string {
  if (gitCommonDir === null) {
    return NO_REPO_LABEL
  }
  const base = basename(gitCommonDir)
  return base === GIT_SUFFIX ? basename(dirname(gitCommonDir)) : base
}

// Projects sort by label; ties break on gitCommonDir string with null last.
function compareProjects(a: PanelProject, b: PanelProject): number {
  const byLabel = a.label.localeCompare(b.label)
  if (byLabel !== 0) {
    return byLabel
  }
  if (a.gitCommonDir === b.gitCommonDir) {
    return 0
  }
  if (a.gitCommonDir === null) {
    return 1
  }
  if (b.gitCommonDir === null) {
    return -1
  }
  return a.gitCommonDir.localeCompare(b.gitCommonDir)
}
