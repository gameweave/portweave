import { useCallback, useState } from 'react'

import type { CollapseState } from '../hooks/useCollapseState.ts'
import type { PanelWorktree } from '../types.ts'

import { open, prune } from '../api.ts'
import { formatBytes } from '../format.ts'
import { CopyButton } from './CopyButton.tsx'
import { PrBadge } from './PrBadge.tsx'
import { ServiceRow } from './ServiceRow.tsx'

// The dirty-tree force variant of the remove command. The backend's
// `removeCommand` is always the safe (non-force) form; when the working tree is
// dirty we additionally surface this destructive variant for the user to copy,
// behind a visible warning — never auto-run. See 02-write-actions-triage.md B-9.
function forceRemoveCommand(removeCommand: string): string {
  return removeCommand.replace(
    'git worktree remove ',
    'git worktree remove --force ',
  )
}

function chevron(collapsed: boolean): string {
  return collapsed ? '▸' : '▾'
}

export function WorktreeCard({
  collapse,
  gitCommonDir,
  launchSupported,
  onAction,
  worktree,
}: {
  readonly collapse: CollapseState
  readonly gitCommonDir: null | string
  readonly launchSupported: boolean
  readonly onAction: () => void
  readonly worktree: PanelWorktree
}) {
  const collapsed = collapse.isCollapsed(worktree.worktreeRoot)
  const dirty = worktree.workingTreeClean === false

  const [confirming, setConfirming] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [actionError, setActionError] = useState<null | string>(null)

  const confirmPrune = useCallback(() => {
    setPruning(true)
    setActionError(null)
    void (async () => {
      try {
        const result = await prune({
          gitCommonDir,
          namespace: worktree.namespace,
          worktreeRoot: worktree.worktreeRoot,
        })
        setConfirming(false)
        if (result.removed) {
          onAction()
        } else {
          setActionError('No allocation matched — nothing pruned.')
        }
      } catch (caught: unknown) {
        setActionError(
          caught instanceof Error ? caught.message : 'Prune failed',
        )
      } finally {
        setPruning(false)
      }
    })()
  }, [gitCommonDir, onAction, worktree.namespace, worktree.worktreeRoot])

  return (
    <div className="worktree-card">
      <div className="worktree-header">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={!collapsed}
          onClick={() => {
            collapse.toggle(worktree.worktreeRoot)
          }}
          title={collapsed ? 'Expand worktree' : 'Collapse worktree'}
        >
          <span className="collapse-chevron" aria-hidden="true">
            {chevron(collapsed)}
          </span>
          <span className="worktree-namespace">{worktree.namespace}</span>
          {worktree.branch !== null ? (
            <span className="worktree-branch" title="git branch">
              {worktree.branch}
            </span>
          ) : null}
        </button>

        {worktree.kind === 'main' ? (
          <span className="main-tag" title="main checkout">
            main
          </span>
        ) : null}

        {worktree.prStatus !== null ? (
          <PrBadge prStatus={worktree.prStatus} />
        ) : null}

        {worktree.safeToPrune ? (
          <span className="prune-pill" title="linked, PR merged/closed, working tree clean">
            ✓ safe to prune
          </span>
        ) : null}

        {worktree.degraded ? (
          <span className="degraded-marker">
            <span className="degraded-badge">degraded</span>
            {worktree.degradedReason ? (
              <span className="degraded-reason">{worktree.degradedReason}</span>
            ) : null}
          </span>
        ) : null}

        <span className="disk-size" title="on-disk size">
          {formatBytes(worktree.diskSizeBytes)}
        </span>

        <span className="worktree-root" title={worktree.worktreeRoot}>
          {worktree.worktreeRoot}
        </span>
      </div>

      {collapsed ? null : (
        <>
          {worktree.services.length > 0 ? (
            worktree.services.map((service) => (
              <ServiceRow key={service.name} service={service} />
            ))
          ) : (
            <div className="worktree-empty">No services allocated.</div>
          )}

          <div className="worktree-actions">
            {confirming ? (
              <span className="confirm-row" role="group" aria-label="Confirm prune">
                <span className="confirm-text">
                  Remove this allocation from the registry?
                </span>
                <button
                  type="button"
                  className="action-button action-danger"
                  onClick={confirmPrune}
                  disabled={pruning}
                >
                  {pruning ? 'Pruning…' : 'Confirm prune'}
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => {
                    setConfirming(false)
                  }}
                  disabled={pruning}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="action-button"
                onClick={() => {
                  setActionError(null)
                  setConfirming(true)
                }}
              >
                Prune
              </button>
            )}

            <CopyButton
              className="action-button"
              label="Copy remove command"
              value={worktree.removeCommand}
              title={worktree.removeCommand}
            />

            <CopyButton
              className="action-button"
              label="Copy path"
              value={worktree.worktreeRoot}
              title={worktree.worktreeRoot}
            />

            {launchSupported ? (
              <>
                <LaunchButton
                  target="editor"
                  label="Open in editor"
                  worktreeRoot={worktree.worktreeRoot}
                />
                <LaunchButton
                  target="terminal"
                  label="Open terminal"
                  worktreeRoot={worktree.worktreeRoot}
                />
              </>
            ) : null}
          </div>

          {dirty ? (
            <div className="force-warning" role="note">
              <span className="force-warning-text">
                Working tree is dirty — the safe remove will refuse. Force-remove
                discards uncommitted changes:
              </span>
              <code className="force-command">
                {forceRemoveCommand(worktree.removeCommand)}
              </code>
              <CopyButton
                className="action-button action-danger"
                label="Copy --force command"
                value={forceRemoveCommand(worktree.removeCommand)}
                title="Destructive — discards uncommitted changes"
              />
            </div>
          ) : null}

          {actionError !== null ? (
            <div className="action-error" role="alert">
              {actionError}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function LaunchButton({
  label,
  target,
  worktreeRoot,
}: {
  readonly label: string
  readonly target: 'editor' | 'terminal'
  readonly worktreeRoot: string
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<null | string>(null)

  const onClick = useCallback(() => {
    setBusy(true)
    setFailed(null)
    void (async () => {
      try {
        const result = await open({ target, worktreeRoot })
        if (!result.launched) {
          setFailed(result.reason ?? 'launch failed')
        }
      } catch (caught: unknown) {
        setFailed(caught instanceof Error ? caught.message : 'launch failed')
      } finally {
        setBusy(false)
      }
    })()
  }, [target, worktreeRoot])

  return (
    <button
      type="button"
      className="action-button"
      onClick={onClick}
      disabled={busy}
      title={failed ?? label}
    >
      {busy ? 'Opening…' : label}
    </button>
  )
}
