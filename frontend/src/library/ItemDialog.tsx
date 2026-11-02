// The dialog where one library item is edited (Dialog, named by the item): its form, with Save
// and Cancel (which closes it), then New version and Delete, then what it lists and where it's
// used (`children`). New version and Delete open their own form or confirm in place of the item's
// form, never a second dialog, and going back from either returns focus to its button. Saving,
// adding a version, and deleting close the dialog (the page does that); changing a list doesn't.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Dialog from '../shared/components/Dialog/Dialog'

type Mode = 'item' | 'version' | 'delete'

export default function ItemDialog({
  title,
  headingId,
  notice,
  form,
  newVersion,
  confirmDelete,
  onClose,
  children,
}: {
  title: string
  headingId?: string
  // Said in the dialog, for a change that keeps it open (a tone's rule deleted).
  notice?: string | null
  // The item's own form. Left out for an item that can't be changed (a built-in section).
  form?: ReactNode
  // The new version form; `back` returns to the item's form.
  newVersion?: (back: () => void) => ReactNode
  // The delete confirm; `back` returns to the item's form. Left out for a built-in item.
  confirmDelete?: (back: () => void) => ReactNode
  onClose: () => void
  children?: ReactNode
}) {
  const [mode, setMode] = useState<Mode>('item')
  const [returnTo, setReturnTo] = useState<Mode | null>(null)
  const versionRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (returnTo === 'version') versionRef.current?.focus()
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

  return (
    <Dialog title={title} headingId={headingId} notice={notice} onClose={onClose}>
      {mode === 'version' && newVersion?.(back)}
      {mode === 'delete' && confirmDelete?.(back)}
      {mode === 'item' && (
        <>
          {form}
          {(newVersion || confirmDelete) && (
            <div className="actions">
              {newVersion && (
                <button type="button" ref={versionRef} onClick={() => open('version')}>
                  New version
                </button>
              )}
              {confirmDelete && (
                <button type="button" ref={deleteRef} onClick={() => open('delete')}>
                  Delete
                </button>
              )}
            </div>
          )}
        </>
      )}
      {children}
    </Dialog>
  )
}
