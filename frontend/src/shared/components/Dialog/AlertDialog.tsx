// A page's notice ("Saved the posting.", "Deleted "AI".") as a modal alert dialog: the message and
// OK. It's open while `message` is set; OK and Escape call `onClose`, which clears it. It's named by
// its message, and OK takes focus when it opens, so a screen reader reads the message once. A new
// message while it's open replaces it and is read again. When it closes, focus goes where the
// change asked for it while it was open (useFocusLater), or else back to where it was
// (the page heading, if that's gone).
import { useEffect, useId, useRef } from 'react'
import { holdFocus, PAGE_HEADING_ID } from '../../hooks/useFocusLater'
import styles from './Dialog.module.css'

export default function AlertDialog({ message, onClose }: { message: string | null; onClose: () => void }) {
  // A new message opens it again, so it's read again.
  return message ? <Open key={message} message={message} onClose={onClose} /> : null
}

function Open({ message, onClose }: { message: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement as HTMLElement | null
    const release = holdFocus()
    dialog.showModal()
    okRef.current?.focus()
    return () => {
      dialog.close()
      const held = release()
      const target = held ? document.getElementById(held) : opener
      // When what had focus is gone (a deleted item, so focus fell to the body), focus goes to the
      // page heading.
      if (target?.isConnected && target !== document.body) target.focus()
      else document.getElementById(PAGE_HEADING_ID)?.focus()
    }
  }, [])

  // Escape closes it from anywhere, as in Dialog, and OK is its only control, so Tab stays on it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        okRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      className={`${styles.dialog} ${styles.alert}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <p id={id}>{message}</p>
      <div className="actions">
        <button type="button" ref={okRef} onClick={onClose}>
          OK
        </button>
      </div>
    </dialog>
  )
}
