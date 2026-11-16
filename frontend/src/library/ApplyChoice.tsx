// When changing a library item that resumes or cover letters in progress use, asks which of them
// get the change too: one checkbox each, none checked to start. Opened from one of them (a tree
// row), that one gets the change anyway, so only the others are offered (`others`). Unchecked
// ones keep the item as it is, so unless every one is checked (and nothing sent uses it), the
// change is saved as a new version. A header offers postings (whose resumes and cover letters
// share its header) and base resumes and cover letters. Sent versions never change, so they
// aren't offered here, except for a tone (`sentToo`): tones aren't printed, so sent ones are
// offered too, listed after the ones in progress and tagged "sent" (docs/FRONTEND_CHECKS.md,
// "Changing an item").
import { useId } from 'react'
import { KIND_LABELS, type Use } from '../shared/api/usage'
import { sortByName } from '../shared/sortByName'

const same = (a: Use, b: Use) => a.kind === b.kind && a.id === b.id

export default function ApplyChoice({
  uses,
  others = false,
  sentToo = false,
  applyTo,
  onChange,
}: {
  // The resumes and cover letters that use the item and can get the change: the ones in progress
  // (not sent), or with `sentToo`, sent ones too.
  uses: Use[]
  // Opened from one of them, which gets the change anyway: these are the others.
  others?: boolean
  // A tone's: sent ones can change too.
  sentToo?: boolean
  applyTo: Use[]
  onChange: (applyTo: Use[]) => void
}) {
  const noteId = useId()
  const byName = (list: Use[]) => sortByName(list, (use) => `${KIND_LABELS[use.kind]}: ${use.name}`)
  // The ones in progress first, then the sent ones.
  const listed = [...byName(uses.filter((use) => !use.locked)), ...byName(uses.filter((use) => use.locked))]
  const anySent = listed.some((use) => use.locked)
  return (
    <fieldset className="choice" aria-describedby={noteId}>
      <legend>
        Apply this change to which {others ? 'other ' : ''}resumes and cover letters{sentToo ? '' : ' in progress'}?
      </legend>
      {listed.map((use) => (
        <label key={`${use.kind}-${use.id}`}>
          <input
            type="checkbox"
            checked={applyTo.some((picked) => same(picked, use))}
            onChange={(event) =>
              onChange(uses.filter((other) => (same(other, use) ? event.target.checked : applyTo.some((picked) => same(picked, other)))))
            }
          />
          {KIND_LABELS[use.kind]}: {use.name}
          {/* The space keeps "sent" a word of its own in the checkbox's name. */}
          {use.locked && (
            <>
              {' '}
              <span className="tag">sent</span>
            </>
          )}
        </label>
      ))}
      <p id={noteId} className="muted">
        Unchecked ones keep it as it is.
        {anySent && ' Checking a sent one changes only its tone, not what was sent.'}
      </p>
    </fieldset>
  )
}
