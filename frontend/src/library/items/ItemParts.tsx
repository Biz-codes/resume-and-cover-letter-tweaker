// The parts of a library item's dialog, the same for every kind: its form, with Save and Cancel
// (which closes the dialog), then New version and Delete, then what it lists and where it's used
// (`children`). New version and Delete open their own form or confirm in place of the item's form,
// never a second dialog, and going back from either returns focus to its button.
import { useEffect, useRef, useState, type ReactNode } from 'react'

type Mode = 'item' | 'version' | 'delete'

export default function ItemParts({
  form,
  newVersion,
  confirmDelete,
  children,
}: {
  // The item's own form. Left out for an item that can't be changed (a built-in section).
  form?: ReactNode
  // The new version form; `back` returns to the item's form.
  newVersion?: (back: () => void) => ReactNode
  // The delete confirm; `back` returns to the item's form. Left out for a built-in item.
  confirmDelete?: (back: () => void) => ReactNode
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
    <>
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
    </>
  )
}
