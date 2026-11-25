// One part of a library card (a list, "Used by") that opens and closes. It starts open when
// it holds anything and closed when empty, and its heading shows how many items it holds. Without
// a count (a part that isn't a list, such as asking Claude), it starts closed. The title can hold
// a visually hidden part that tells repeated ones apart (a chat card's "Details of …").
// The browser's own marker is replaced by the chevron (index.css), which is decoration: screen
// readers hear the <details> state. Its summary stays where it was on the screen as it opens or
// closes (keepInPlace).
import { useRef, type ReactNode } from 'react'
import Icon from '../../shared/components/Icon/Icon'
import { measure } from '../../shared/keepInPlace'
import styles from './Collapsible.module.css'

export default function Collapsible({
  title,
  count,
  children,
}: {
  title: ReactNode
  count?: number
  children: ReactNode
}) {
  // Set by a click on the summary (Enter and Space click it too); the details' toggle event
  // comes once it has opened or closed.
  const restore = useRef<(() => void) | null>(null)
  return (
    <details
      className={`${styles.sublist} collapsible`}
      open={count !== undefined && count > 0}
      onToggle={() => {
        restore.current?.()
        restore.current = null
      }}
    >
      <summary onClick={(event) => (restore.current = measure(event.currentTarget))}>
        <Icon name="chevron" size={16} className="disclosure-mark" />
        <span>
          {title}
          {count !== undefined && ` (${count})`}
        </span>
      </summary>
      {children}
    </details>
  )
}
