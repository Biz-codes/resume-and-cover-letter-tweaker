// When changing a library item that resumes or cover letters in progress use, asks which of them
// get the change too: one checkbox each, none checked to start. Opened from one of them (a tree
// row), that one gets the change anyway, so only the others are offered (`others`). Unchecked
// ones keep the item as it is, so unless every one is checked (and nothing sent uses it), the
// change is saved as a new version. Sent versions never change, so they aren't offered here
// (docs/FRONTEND_CHECKS.md, "Changing an item").
import { useId } from 'react'
import { KIND_LABELS, type Use } from '../shared/api/usage'
import { sortByName } from '../shared/sortByName'

const same = (a: Use, b: Use) => a.kind === b.kind && a.id === b.id

export default function ApplyChoice({
  uses,
  others = false,
  applyTo,
  onChange,
}: {
  // The resumes and cover letters in progress (not sent) that use the item.
  uses: Use[]
  // Opened from one of them, which gets the change anyway: these are the others.
  others?: boolean
  applyTo: Use[]
  onChange: (applyTo: Use[]) => void
}) {
  const noteId = useId()
  return (
    <fieldset className="choice" aria-describedby={noteId}>
      <legend>Apply this change to which {others ? 'other ' : ''}resumes and cover letters in progress?</legend>
      {sortByName(uses, (use) => `${KIND_LABELS[use.kind]}: ${use.name}`).map((use) => (
        <label key={`${use.kind}-${use.id}`}>
          <input
            type="checkbox"
            checked={applyTo.some((picked) => same(picked, use))}
            onChange={(event) =>
              onChange(uses.filter((other) => (same(other, use) ? event.target.checked : applyTo.some((picked) => same(picked, other)))))
            }
          />
          {KIND_LABELS[use.kind]}: {use.name}
        </label>
      ))}
      <p id={noteId} className="muted">
        Unchecked ones keep it as it is.
      </p>
    </fieldset>
  )
}
