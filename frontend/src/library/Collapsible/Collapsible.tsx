// One part of a library card (a list, "Used by") that opens and closes. It starts open when
// it holds anything and closed when empty, and its heading shows how many items it holds.
import type { ReactNode } from 'react'
import styles from './Collapsible.module.css'

export default function Collapsible({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <details className={styles.sublist} open={count > 0}>
      <summary>
        {title} ({count})
      </summary>
      {children}
    </details>
  )
}
