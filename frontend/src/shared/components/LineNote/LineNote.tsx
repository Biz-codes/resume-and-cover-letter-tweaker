// How many printed lines a text takes, while it's worked on (shared/lineFit.ts): with `id`, a
// visible note for one that wraps ("2 lines, 8 characters on the second"), which the field it
// describes points to; and always a live region that says when the count changes ("Front End now
// takes 2 lines."), never on every keystroke, and nothing when it first shows.
import { useState } from 'react'
import { lineFit, lineNote } from '../../lineFit'

export default function LineNote({
  text,
  bullet = false,
  id,
  what,
}: {
  text: string
  bullet?: boolean
  // The visible note's id, for the field's aria-describedby; without it, only the live region.
  id?: string
  // What the announcement names ("Front End", "The bullet").
  what: string
}) {
  const { lines } = lineFit(text, bullet)
  const [shown, setShown] = useState(lines)
  const [said, setSaid] = useState('')
  // A changed count is said once, when it changes.
  if (lines !== shown) {
    setShown(lines)
    setSaid(lines === 1 ? `${what} now fits on one line.` : `${what} now takes ${lines} lines.`)
  }
  const note = lineNote(text, bullet)
  return (
    <>
      {id && note && (
        <p className="muted" id={id}>
          {note}
        </p>
      )}
      <p aria-live="polite" className="visually-hidden">
        {said}
      </p>
    </>
  )
}
