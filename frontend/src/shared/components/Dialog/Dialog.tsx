// A modal dialog (the native <dialog>, opened with showModal, so nothing behind it can be reached
// while it's open). It's open while it's rendered: render it to open it, and stop rendering it in
// `onClose`, which Close and Escape both call. It's named by its heading, which takes focus when
// it opens and again when `title` changes (the dialog showing another item). When it closes,
// focus goes back to what had it before it opened; a page that wants focus somewhere else (after
// a delete, the page heading) moves it with useFocusLater, which runs after this.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'

export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()

  useEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      opener?.focus()
    }
  }, [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [title])

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={headingId}
      onCancel={(event) => {
        // Escape: the page closes it by no longer rendering it, so it stays in step with the page.
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.top}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  )
}
