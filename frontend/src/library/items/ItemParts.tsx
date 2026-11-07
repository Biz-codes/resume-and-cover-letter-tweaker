// The parts of a library item's dialog, the same for every kind: its form, with Save and Cancel
// (which closes the dialog), then Hide (or Unhide) and Delete, then what it lists and where it's
// used (`children`). Delete opens its confirm in place of the item's form, never a second dialog,
// and going back returns focus to its button. Hide keeps the dialog open and says so in it (docs/FRONTEND_CHECKS.md, "Hiding").
// An item a sent application uses can't be deleted, so it offers only Hide, with a note saying
// why.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { useOptionalItemHost } from './itemHost'

type Mode = 'item' | 'delete'

export const HIDDEN_NOTE = "Hidden: it isn't offered anywhere new. Everything that uses it keeps it."
export const SENT_DELETE_NOTE = "A sent application uses it, so it can't be deleted. Hide it to set it aside."

export default function ItemParts({
  name,
  form,
  confirmDelete,
  hidden,
  usedBySent = false,
  onSetHidden,
  children,
}: {
  // The item's name as its buttons say it (`"Led the redesign."`), so Hide and Delete each name
  // their item.
  name: string
  form: ReactNode
  // The delete confirm; `back` returns to the item's form. Left out for a built-in item.
  confirmDelete?: (back: () => void) => ReactNode
  hidden?: boolean
  // A sent application uses it: Delete is left out.
  usedBySent?: boolean
  // Hides or unhides it. Left out for a built-in item, which can't be hidden.
  onSetHidden?: (hidden: boolean) => Promise<void>
  children?: ReactNode
}) {
  const host = useOptionalItemHost()
  const [mode, setMode] = useState<Mode>('item')
  const [returnTo, setReturnTo] = useState<Mode | null>(null)
  const [hiding, setHiding] = useState(false)
  const [hideError, setHideError] = useState<ApiError | null>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (returnTo === 'delete') deleteRef.current?.focus()
  }, [returnTo])

  function open(next: Mode) {
    setReturnTo(null)
    setMode(next)
  }

  function back() {
    setReturnTo(mode)
    setMode('item')
  }

  async function toggleHidden() {
    if (!onSetHidden || hiding) return
    setHiding(true)
    setHideError(null)
    try {
      await onSetHidden(!hidden)
      host?.say(hidden ? 'Unhidden. It’s offered again.' : 'Hidden. It isn’t offered anywhere new.')
    } catch (caught) {
      setHideError(toApiError(caught))
    }
    setHiding(false)
  }

  const canDelete = Boolean(confirmDelete) && !usedBySent
  const hideLabel = hidden ? 'Unhide' : 'Hide'

  return (
    <>
      {mode === 'delete' && confirmDelete?.(back)}
      {mode === 'item' && (
        <>
          {form}
          {hidden && <p className="muted">{HIDDEN_NOTE}</p>}
          {usedBySent && confirmDelete && <p className="muted">{SENT_DELETE_NOTE}</p>}
          {(onSetHidden || canDelete) && (
            <div className="actions">
              {onSetHidden && (
                // aria-disabled, not disabled, so the button keeps focus while it saves.
                <button
                  type="button"
                  aria-disabled={hiding}
                  aria-label={`${hiding ? `${hidden ? 'Unhiding' : 'Hiding'}…` : hideLabel} ${name}`}
                  onClick={() => void toggleHidden()}
                >
                  {hiding ? `${hidden ? 'Unhiding' : 'Hiding'}…` : hideLabel}
                </button>
              )}
              {canDelete && (
                <button type="button" ref={deleteRef} aria-label={`Delete ${name}`} onClick={() => open('delete')}>
                  Delete
                </button>
              )}
            </div>
          )}
          {hideError && <p role="alert">{hideError.message}</p>}
        </>
      )}
      {children}
    </>
  )
}
