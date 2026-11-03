// A modal dialog (the native <dialog>, opened with showModal, so nothing behind it can be reached
// while it's open). It's open while it's rendered: render it to open it, and stop rendering it in
// `onClose`, which Close and Escape both call. It's named by its heading, which takes focus when
// it opens and again when it shows another item (`showing`, or else its title, changes). When it closes,
// focus goes back to what had it before it opened; a page that wants focus somewhere else (after
// a delete, the page heading) moves it with useFocusLater, which runs after this. `headingId`
// lets a page move focus back to the heading after removing something inside the dialog. A change that
// keeps it open is said in its own notice (`notice`), not the page's AlertDialog, since one dialog
// never opens inside another; it's always rendered so it's announced when its text changes.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'

const FOCUSABLE = 'button, [href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'

// The controls Tab can reach inside `root`, in order: not disabled, not hidden, and not inside a
// closed <details> (apart from its own summary).
function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (element.matches(':disabled') || element.closest('[hidden]')) return false
    const closed = element.closest('details:not([open])')
    return !closed || (element.matches('summary') && element.parentElement === closed)
  })
}

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

  // Focus stays inside: Tab from the last control goes to the first and Shift+Tab from the first
  // to the last, instead of out to the browser's own controls, and when the focused element is
  // removed (a list row, a form that closed) focus goes to the heading, unless the change moved
  // it somewhere else (useFocusLater runs first).
  useEffect(() => {
    const dialog = dialogRef.current!
    function wrapTab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const controls = focusables(dialog)
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      const active = document.activeElement
      const outside = !active || !controls.includes(active as HTMLElement)
      if (event.shiftKey && (active === first || active === headingRef.current || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || (outside && active !== headingRef.current))) {
        event.preventDefault()
        first.focus()
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const watcher = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (dialog.open && !dialog.contains(document.activeElement)) headingRef.current?.focus()
      })
    })
    watcher.observe(dialog, { childList: true, subtree: true })
    document.addEventListener('keydown', wrapTab)
    return () => {
      clearTimeout(timer)
      watcher.disconnect()
      document.removeEventListener('keydown', wrapTab)
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
