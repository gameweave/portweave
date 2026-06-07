import { useCallback, useState } from 'react'

// Copy-to-clipboard button with a brief "Copied" affordance. Pure frontend —
// no route. Clipboard access can reject (permissions / insecure context), so
// the write is guarded and the button simply does not flip to "Copied" on
// failure rather than throwing.

const COPIED_RESET_MS = 1500

export function CopyButton({
  className = 'copy-button',
  label,
  title,
  value,
}: {
  readonly className?: string
  readonly label: string
  readonly title?: string
  readonly value: string
}) {
  const [copied, setCopied] = useState(false)

  const onClick = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => {
          setCopied(false)
        }, COPIED_RESET_MS)
      } catch {
        // pw-allow-swallow: clipboard denied/unavailable — no affordance flip
        setCopied(false)
      }
    })()
  }, [value])

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={title ?? value}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
