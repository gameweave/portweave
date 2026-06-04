import type { PanelProject } from '../types.ts'

import { WorktreeCard } from './WorktreeCard.tsx'

export function ProjectGroup({ project }: { project: PanelProject }) {
  return (
    <section className="project-group">
      <div className="project-header">
        <h2 className="project-label">{project.label}</h2>
        {project.gitCommonDir ? (
          <span className="project-path" title={project.gitCommonDir}>
            {project.gitCommonDir}
          </span>
        ) : null}
      </div>
      {project.worktrees.map((worktree) => (
        <WorktreeCard key={worktree.worktreeRoot} worktree={worktree} />
      ))}
    </section>
  )
}
