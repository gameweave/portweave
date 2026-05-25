// pw-stub: replaced by run-command on merge.
// The run-command worktree owns the real implementation of formatAllocationBanner.
// This stub exists solely so that src/cli/show.ts compiles and tests pass in the
// show-command worktree before the two branches are merged.
import type { Config } from '../config/index.ts'
import type { Allocation } from '../allocator/allocate.ts'

export interface BannerOptions {
  launching?: string
  reused?: boolean
  wroteEnvFile?: boolean
}

export function formatAllocationBanner(
  allocation: Allocation,
  config: Config,
  options: BannerOptions = {},
): string {
  const { launching, wroteEnvFile } = options
  const baseName =
    allocation.key.worktreeRoot.split('/').pop() ?? allocation.key.worktreeRoot
  const lines: string[] = []

  lines.push(
    `[portweave] worktree: ${baseName} (namespace: ${allocation.namespace})`,
  )
  lines.push('[portweave] allocated:')

  for (const service of config.services) {
    const port = allocation.ports[service.name]
    lines.push(
      `  ${service.name.padEnd(16)}→ ${String(port).padEnd(8)}(${service.envVar})`,
    )
  }

  if (wroteEnvFile === true) {
    lines.push('[portweave] wrote .portweave/current.env')
  }

  if (launching !== undefined) {
    lines.push(`[portweave] launching: ${launching}`)
  }

  return lines.join('\n') + '\n'
}
