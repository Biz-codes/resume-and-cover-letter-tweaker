// Starting a resume or cover letter for a job posting: its name, and where it starts from (fresh,
// with the usual defaults, or a copy of any earlier one, base or tailored). It uses the posting's
// header. The original of a copy never changes. It opens in place of its
// button, so focus moves to the name, and back to the button when it's cancelled. See "Starting a
// version for a posting" in docs/FRONTEND_CHECKS.md.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'
import { KINDS, type Doc, type DocKind } from '../api/documents'
import type { PostingDetail } from '../api/postings'
import { useFocusLater } from '../hooks/useFocusLater'

export default function StartVersion({
  kind,
  posting,
  docs,
  onStart,
}: {
  kind: DocKind
  // It has a header and isn't applied to (the page doesn't offer this otherwise).
  posting: PostingDetail
  // Every resume or cover letter, to start a copy of.
  docs: Doc[]
  // `fromId` is the version to copy, or null to start fresh.
  onStart: (name: string, fromId: number | null) => Promise<void>
}) {
  const { singular } = KINDS[kind]
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(`${posting.role_title} (${posting.organization})`)
  const [from, setFrom] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const focusLater = useFocusLater()
  // PostingPage moves focus here once the posting's header is picked.
  const buttonId = `start-${kind}`

  useEffect(() => {
    if (open) nameRef.current?.focus()
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
      await onStart(name, from ? Number(from) : null)
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  const invalid = (field: string) => ({
    'aria-invalid': error?.field === field,
    'aria-describedby': error?.field === field ? errorId : undefined,
  })
  const bases = docs.filter((doc) => !doc.job_posting)
  const tailored = docs.filter((doc) => doc.job_posting)

  return (
    <form className="card stacked-form" onSubmit={submit} aria-label={`Start a ${singular} for this posting`}>
      <label>
        Resume name (required)
        <input
          ref={nameRef}
          value={name}
          aria-required="true"
          {...invalid('name')}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Start from
        <select value={from} onChange={(event) => setFrom(event.target.value)}>
          <option value="">Fresh, with the usual defaults</option>
          {/* Base versions first, then the ones for postings, named with their organization. */}
          {[...bases, ...tailored].map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.name}
              {doc.job_posting && ` (for ${doc.job_posting.organization})`}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
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
