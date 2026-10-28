// The delete warning: what else changes, and whether a sent version is affected. It opens in
// place of the Delete button, so focus moves to its Cancel button (the safe choice), and the
// group is named by its question so screen readers announce what's being deleted.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { ApiError } from '../api/client'
import { anyLocked, type Use } from '../api/usage'

export default function ConfirmDelete({
  what,
  uses,
  effect,
  error,
  onConfirm,
  onCancel,
}: {
  what: string
  uses: Use[]
  // What happens to the things that use it, e.g. "They keep going with no header."
  effect: ReactNode
  error: ApiError | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const questionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => cancelRef.current?.focus(), [])

  return (
    <div className="confirm" role="group" aria-labelledby={questionId}>
      <p id={questionId}>Delete {what}?</p>
      {uses.length > 0 && (
        <p>
          Used by: {uses.map((use) => use.name).join('; ')}. {effect}
        </p>
      )}
      {anyLocked(uses) && <p>A sent version uses it, so deleting it changes the record of what you sent.</p>}
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        <button type="button" onClick={onConfirm}>
          Delete
        </button>
        <button type="button" ref={cancelRef} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
