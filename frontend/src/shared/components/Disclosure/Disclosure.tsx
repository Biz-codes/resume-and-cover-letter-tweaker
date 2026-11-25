// One level of a nested, expandable list (the WAI-ARIA disclosure pattern): a button that opens
// and closes what's under it. Starts closed, unless `initiallyOpen`. What's under it is only
// rendered while open. With `heading`, the button sits in a heading of that level, for a part of
// the page with headings of its own (the preview), so it's still found by heading. `onToggle`
// hears each open and close, for a caller that remembers it. `id` names its button, for a caller
// that moves focus to it.
import { useId, useState, type ReactNode } from 'react'
import { useKeepInPlace } from '../../keepInPlace'
import Icon from '../Icon/Icon'
import styles from './Disclosure.module.css'

export default function Disclosure({
  title,
  id,
  heading,
  initiallyOpen = false,
  onToggle,
  children,
}: {
  title: ReactNode
  id?: string
  heading?: 3 | 4
  initiallyOpen?: boolean
  onToggle?: (open: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const bodyId = useId()
  // The button stays where it was on the screen as the level opens or closes.
  const hold = useKeepInPlace()
  const toggle = (
    <button
      type="button"
      id={id}
      className="disclosure-toggle"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={(event) => {
        hold(event.currentTarget)
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
