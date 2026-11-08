// Starting a resume or cover letter for a job posting, one of three ways: Claude tailors it (it
// picks the saved one that fits the posting best and makes a draft to review), a copy of any
// earlier one as is, base or tailored, or from scratch, empty. Claude's way and an empty one take
// a tone; a copy keeps the original's. It uses the posting's header and is named for the posting.
// The original of a copy never changes. It opens in place of its button, so focus moves to the
// choice, and back to the button when it's cancelled. See "Starting a version for a posting" and
// "Claude's suggestions" in docs/FRONTEND_CHECKS.md.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../shared/api/client'
import { KINDS, shownName, type Doc, type DocKind } from '../shared/api/documents'
import type { ToneSet } from '../shared/api/toneSets'
import { toneLabels } from '../library/items/itemFields'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import { offered } from '../shared/offered'
import { sortByName } from '../shared/sortByName'

export type StartChoice =
  | { how: 'claude'; toneSetId: number | null }
  | { how: 'copy'; fromId: number }
  | { how: 'scratch'; toneSetId: number | null }

type How = StartChoice['how']

export default function StartVersion({
  kind,
  docs,
  toneSets,
  onStart,
}: {
  kind: DocKind
  // Every resume or cover letter, to start a copy of.
  docs: Doc[]
  toneSets: ToneSet[]
  onStart: (choice: StartChoice) => Promise<void>
}) {
  const { singular, plural } = KINDS[kind]
  const [open, setOpen] = useState(false)
  const [how, setHow] = useState<How>('claude')
  const [from, setFrom] = useState('')
  const [tone, setTone] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const focusLater = useFocusLater()
  // PostingPage moves focus here once the posting's header is picked.
  const buttonId = `start-${kind}`
  const fromId = `start-from-${kind}`

  useEffect(() => {
    if (open) firstRef.current?.focus()
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
    if (how === 'copy' && !from) {
      setError(new ApiError('VALIDATION_FAILED', `Choose a ${singular} to copy.`, 'from', 422))
      focusLater(fromId)
      return
    }
    setSaving(true)
    setError(null)
    const toneSetId = tone ? Number(tone) : null
    try {
      await onStart(how === 'copy' ? { how, fromId: Number(from) } : { how, toneSetId })
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  // Hidden ones aren't offered ("Hiding").
  const bases = offered(docs).filter((doc) => !doc.job_posting)
  const tailored = offered(docs).filter((doc) => doc.job_posting)
  const nameOf = (doc: Doc) =>
    doc.job_posting ? `${doc.name} (for ${doc.job_posting.organization})` : shownName(kind, doc)
  const toneLabel = toneLabels(toneSets)
  const choices: { value: How; label: string }[] = [
    { value: 'claude', label: `Claude tailors one of your saved ${plural.toLowerCase()}` },
    { value: 'copy', label: `Copy a saved ${singular} as is` },
    { value: 'scratch', label: 'Build from scratch (empty)' },
  ]
  const fromError = error?.field === 'from'

  return (
    <form className="card stacked-form" onSubmit={submit} aria-label={`Start a ${singular} for this posting`}>
      <fieldset className="choice">
        <legend>How to start</legend>
        {choices.map((choice, index) => (
          <label key={choice.value}>
            <input
              ref={index === 0 ? firstRef : undefined}
              type="radio"
              name={`start-how-${kind}`}
              value={choice.value}
              checked={how === choice.value}
              onChange={() => {
                setHow(choice.value)
                setError(null)
              }}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      {how === 'copy' ? (
        <label>
          Start from
          <select
            id={fromId}
            value={from}
            aria-invalid={fromError}
            aria-describedby={fromError ? `${fromId}-error` : undefined}
            onChange={(event) => setFrom(event.target.value)}
          >
            <option value="">Choose a {singular}</option>
            {/* Base versions first, then the ones for postings, named with their organization, each A to Z. */}
            {[...sortByName(bases, nameOf), ...sortByName(tailored, nameOf)].map((doc) => (
              <option key={doc.id} value={doc.id}>
                {nameOf(doc)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Tone
          <select value={tone} onChange={(event) => setTone(event.target.value)}>
            <option value="">None</option>
            {sortByName(offered(toneSets), toneLabel).map((item) => (
              <option key={item.tone_set_id} value={item.tone_set_id}>
                {toneLabel(item)}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" id={fromError ? `${fromId}-error` : undefined}>
          {error.message}
        </p>
      )}
      {/* Always rendered, so screen readers hear it when Claude starts. A plain live region rather
          than role="status", as in OrderedList, so the page's notices stay in AlertDialog. */}
      <p aria-live="polite">
        {saving && how === 'claude' ? `Claude is tailoring your ${singular}. This can take a few minutes.` : ''}
      </p>
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving
            ? how === 'claude'
              ? 'Tailoring…'
              : 'Starting…'
            : error?.code === 'AI_UNAVAILABLE'
              ? 'Retry'
              : `Start ${singular}`}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  )
}
