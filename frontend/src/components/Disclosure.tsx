// One level of a nested, expandable list (the WAI-ARIA disclosure pattern): a button that opens
// and closes what's under it. Starts closed. What's under it is only rendered while open.
import { useId, useState, type ReactNode } from 'react'

export default function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <div className="disclosure">
      <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        {title}
      </button>
      <div className="disclosure-body" id={bodyId} hidden={!open}>
        {open && children}
      </div>
    </div>
  )
}
