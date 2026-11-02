// One item on a library page, as a card: its title (a heading), a short summary, and Edit, which
// opens the item's dialog (ItemDialog), where everything else about it is shown and changed. Tags
// ("built in") sit beside the title in the heading, so they're read with it.
import type { ReactNode } from 'react'

export default function LibraryCard({
  title,
  heading = 4,
  titleClassName,
  tags,
  editId,
  editLabel,
  onEdit,
  children,
}: {
  title: ReactNode
  // The heading level: 3 on pages whose cards sit right under the page heading, 4 under a group.
  heading?: 3 | 4
  titleClassName?: string
  tags?: ReactNode
  // The Edit button's id, where focus returns when the dialog closes after a save.
  editId: string
  // Names the item, e.g. `Edit "Engineer, Acme"`, since every card has an Edit button.
  editLabel: string
  onEdit: () => void
  // The summary under the title.
  children?: ReactNode
}) {
  const Heading = heading === 3 ? 'h3' : 'h4'
  return (
    <article className="card">
      <div className="card-header">
        <Heading className={titleClassName}>
          {title}
          {tags}
        </Heading>
        <div className="actions">
          <button type="button" id={editId} aria-label={editLabel} onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
      {children}
    </article>
  )
}
