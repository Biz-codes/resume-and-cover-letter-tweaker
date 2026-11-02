// One item on a library page, as a card that opens and closes (the WAI-ARIA disclosure pattern):
// its title, a button in a heading, with the item's own buttons (Edit, Rename, Delete) beside it,
// so they work whether it's open or closed. It starts closed, so a page reads as a list of titles.
// What opened from those buttons (a delete confirm, a new version form) shows under the title
// either way (`shown`); the rest (lists, "Used by") only while open. A form that edits the title
// itself takes the title's place (`replacesTitle`). Tags ("built in") sit beside the button in the
// heading, so they're read with the title but aren't part of the button's name.
import { useId, useState, type ReactNode } from 'react'

export default function LibraryCard({
  title,
  heading = 4,
  titleClassName,
  tags,
  actions,
  replacesTitle,
  shown,
  children,
}: {
  title: ReactNode
  // The heading level: 3 on pages whose cards sit right under the page heading, 4 under a group.
  heading?: 3 | 4
  titleClassName?: string
  tags?: ReactNode
  actions?: ReactNode
  replacesTitle?: ReactNode
  shown?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const Heading = heading === 3 ? 'h3' : 'h4'
  return (
    <article className="card">
      {replacesTitle || (
        <div className="card-header">
          <Heading className={titleClassName}>
            <button
              type="button"
              className="disclosure-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen(!open)}
            >
              {title}
            </button>
            {tags}
          </Heading>
          {actions}
        </div>
      )}
      {shown}
      <div id={bodyId} hidden={!open}>
        {open && children}
      </div>
    </article>
  )
}
