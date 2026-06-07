export function EmptyState() {
  return (
    <div className="state-panel">
      <strong>No allocations yet</strong>
      <span>
        Run <code>portweave run</code> in a project to claim ports.
      </span>
    </div>
  )
}
