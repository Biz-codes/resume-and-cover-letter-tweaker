// One level of a nested, expandable list (the WAI-ARIA disclosure pattern): a button that opens
// and closes what's under it. Starts closed, unless `initiallyOpen`. What's under it is only
// rendered while open. With `heading`, the button sits in a heading of that level, for a part of
// the page with headings of its own (the preview), so it's still found by heading.
import { useId, useState, type ReactNode } from 'react'
import styles from './Disclosure.module.css'

export default function Disclosure({
  title,
  heading,
  initiallyOpen = false,
  children,
}: {
  title: ReactNode
  heading?: 3
  initiallyOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const bodyId = useId()
  const toggle = (
    <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
      {title}
    </button>
  )
  return (
    <div className="disclosure">
      {heading === 3 ? <h3 className="disclosure-heading">{toggle}</h3> : toggle}
      <div className={styles.body} id={bodyId} hidden={!open}>
        {open && children}
      </div>
    </div>
  )
}
