import type { CollapseState } from '../hooks/useCollapseState.ts'
import type { PanelProject } from '../types.ts'

import { WorktreeCard } from './WorktreeCard.tsx'

export function ProjectGroup({
  collapse,
  launchSupported,
  onAction,
  project,
}: {
  readonly collapse: CollapseState
  readonly launchSupported: boolean
  readonly onAction: () => void
  readonly project: PanelProject
}) {
  const id = project.gitCommonDir ?? project.label
  const collapsed = collapse.isCollapsed(id)

  return (
    <section className="project-group">
      <div className="project-header">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={!collapsed}
          onClick={() => {
            collapse.toggle(id)
          }}
          title={collapsed ? 'Expand project' : 'Collapse project'}
        >
          <span className="collapse-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <h2 className="project-label">{project.label}</h2>
        </button>
        {project.gitCommonDir ? (
          <span className="project-path" title={project.gitCommonDir}>
            {project.gitCommonDir}
          </span>
        ) : null}
      </div>
      {collapsed
        ? null
        : project.worktrees.map((worktree) => (
            <WorktreeCard
              key={worktree.worktreeRoot}
              collapse={collapse}
              gitCommonDir={project.gitCommonDir}
              launchSupported={launchSupported}
              onAction={onAction}
              worktree={worktree}
            />
          ))}
    </section>
  )
}
