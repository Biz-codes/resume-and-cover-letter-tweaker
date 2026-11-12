// One part of a library card (a list, "Used by") that opens and closes. It starts open when
// it holds anything and closed when empty, and its heading shows how many items it holds. Without
// a count (a part that isn't a list, such as asking Claude), it starts closed. The title can hold
// a visually hidden part that tells repeated ones apart (a chat card's "Details of …").
import type { ReactNode } from 'react'
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
  return (
    <details className={styles.sublist} open={count !== undefined && count > 0}>
      <summary>
        {title}
        {count !== undefined && ` (${count})`}
      </summary>
      {children}
    </details>
  )
}
