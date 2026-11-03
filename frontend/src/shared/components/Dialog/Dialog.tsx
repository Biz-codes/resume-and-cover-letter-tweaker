// A modal dialog (the native <dialog>, opened with showModal, so nothing behind it can be reached
// while it's open). It's open while it's rendered: render it to open it, and stop rendering it in
// `onClose`, which Close and Escape both call. It's named by its heading, which takes focus when
// it opens and again when it shows another item (`showing`, or else its title, changes). When it closes,
// focus goes back to what had it before it opened; a page that wants focus somewhere else (after
// a delete, the page heading) moves it with useFocusLater, which runs after this. `headingId`
// lets a page move focus back to the heading after removing something inside the dialog. The page's
// own notices can't be reached behind the modal, so the dialog has its own (`notice`), always
// rendered so it's announced when its text changes.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'

export default function Dialog({
  title,
  headingId,
  showing = title,
  notice,
  onClose,
  children,
}: {
  title: string
  headingId?: string
  // Names what the dialog shows, so moving to another item moves focus even if titles match.
  showing?: string
  notice?: string | null
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const generatedId = useId()
  const id = headingId ?? generatedId

  useEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      opener?.focus()
    }
  }, [])

  // Escape closes it from anywhere on the page, even when focus has fallen to the body, without
  // waiting on the browser's cancel event, which not every browser sends. A control that uses
  // Escape itself (OrderedList's move) prevents the default, and the dialog stays open.
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      // Escape while typing with an input method (IME) cancels the composition, not the dialog.
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  useEffect(() => {
    headingRef.current?.focus()
  }, [showing])

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        // A close request the keydown above didn't catch: the page closes it by no longer rendering
        // it, so it stays in step with the page.
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.top}>
        <h2 id={id} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p role="status">{notice}</p>
      {children}
    </dialog>
  )
}
