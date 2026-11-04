// Starting a resume or cover letter for a job posting: where it starts from (fresh, with the usual
// defaults, or a copy of any earlier one, base or tailored). It uses the posting's header and is
// named for the posting. The original of a copy never changes. It opens in place of its button, so
// focus moves to the choice, and back to the button when it's cancelled. See "Starting a version
// for a posting" in docs/FRONTEND_CHECKS.md.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { KINDS, type Doc, type DocKind } from '../shared/api/documents'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import { sortByName } from '../shared/sortByName'

export default function StartVersion({
  kind,
  docs,
  onStart,
}: {
  kind: DocKind
  // Every resume or cover letter, to start a copy of.
  docs: Doc[]
  // `fromId` is the version to copy, or null to start fresh.
  onStart: (fromId: number | null) => Promise<void>
}) {
  const { singular } = KINDS[kind]
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const fromRef = useRef<HTMLSelectElement>(null)
  const focusLater = useFocusLater()
  // PostingPage moves focus here once the posting's header is picked.
  const buttonId = `start-${kind}`

  useEffect(() => {
    if (open) fromRef.current?.focus()
  }, [open])

  if (!open) {
    return (
      <div className="actions">
        <button type="button" id={buttonId} onClick={() => setOpen(true)}>
          Start a {singular}
        </button>
      </div>
    )
  }

  function close() {
    setOpen(false)
    setError(null)
    focusLater(buttonId)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onStart(from ? Number(from) : null)
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  const bases = docs.filter((doc) => !doc.job_posting)
  const tailored = docs.filter((doc) => doc.job_posting)
  const nameOf = (doc: Doc) => (doc.job_posting ? `${doc.name} (for ${doc.job_posting.organization})` : doc.name)

  return (
    <form className="card stacked-form" onSubmit={submit} aria-label={`Start a ${singular} for this posting`}>
      <label>
        Start from
        <select ref={fromRef} value={from} onChange={(event) => setFrom(event.target.value)}>
          <option value="">Fresh, with the usual defaults</option>
          {/* Base versions first, then the ones for postings, named with their organization, each A to Z. */}
          {[...sortByName(bases, nameOf), ...sortByName(tailored, nameOf)].map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.name}
              {doc.job_posting && ` (for ${doc.job_posting.organization})`}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? 'Starting…' : `Start ${singular}`}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  )
}
