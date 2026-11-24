// One level of a nested, expandable list (the WAI-ARIA disclosure pattern): a button that opens
// and closes what's under it. Starts closed, unless `initiallyOpen`. What's under it is only
// rendered while open. With `heading`, the button sits in a heading of that level, for a part of
// the page with headings of its own (the preview), so it's still found by heading. `onToggle`
// hears each open and close, for a caller that remembers it.
import { useId, useState, type ReactNode } from 'react'
import Icon from '../Icon/Icon'
import styles from './Disclosure.module.css'

export default function Disclosure({
  title,
  heading,
  initiallyOpen = false,
  onToggle,
  children,
}: {
  title: ReactNode
  heading?: 3 | 4
  initiallyOpen?: boolean
  onToggle?: (open: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const bodyId = useId()
  const toggle = (
    <button
      type="button"
      className="disclosure-toggle"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={() => {
        setOpen(!open)
        onToggle?.(!open)
      }}
    >
      <Icon name="chevron" size={16} className="disclosure-mark" />
      <span>{title}</span>
    </button>
  )
  const Heading = heading === 4 ? 'h4' : 'h3'
  return (
    <div className="disclosure">
      {heading ? <Heading className="disclosure-heading">{toggle}</Heading> : toggle}
      <div className={styles.body} id={bodyId} hidden={!open}>
        {open && children}
      </div>
    </div>
  )
}
