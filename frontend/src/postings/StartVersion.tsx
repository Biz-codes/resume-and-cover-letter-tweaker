// Starting a resume or cover letter for a job posting, one of five ways: Claude tailors it (from
// the saved one that fits the posting best, or one the user chooses, still drawing on the whole
// library, and makes a draft to review), a copy of any
// earlier one as is, base or tailored, from scratch, empty, or from the user's own file or pasted
// text, which Claude reads for the user to check (ImportReview), then saved as is or tailored by
// Claude from there. All but a copy take a tone; a copy keeps the original's. It uses the
// posting's header and is named for the posting. The original of a copy never changes. It opens
// in place of its button, so focus moves to the choice, and back to the button when it's
// cancelled. See "Starting a version for a posting", "Claude's suggestions", and "Reading an
// existing resume or cover letter" in docs/FRONTEND_CHECKS.md.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../shared/api/client'
import { docsApi, KINDS, shownName, type Doc, type DocKind } from '../shared/api/documents'
import { SOURCE_FIELD, sourceOf, type ImportBody, type Imported } from '../shared/api/imports'
import type { ToneSet } from '../shared/api/toneSets'
import { toneLabels } from '../library/items/itemFields'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import { offered } from '../shared/offered'
import { sortByName } from '../shared/sortByName'
import ImportReview from '../documents/ImportReview/ImportReview'
import SourceField from '../documents/ImportReview/SourceField'

export type StartChoice =
  // `startFromId`: the saved one Claude starts from, or null for Claude to pick.
  | { how: 'claude'; toneSetId: number | null; startFromId: number | null }
  | { how: 'copy'; fromId: number }
  | { how: 'scratch'; toneSetId: number | null }
  // What Claude read in the user's own file or text, as the user corrected it; with `tailor`,
  // Claude then tailors it to the posting.
  | { how: 'imported'; body: ImportBody; toneSetId: number | null; tailor: boolean }

type How = 'claude' | 'copy' | 'scratch' | 'upload' | 'paste'

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
  const [claudeFrom, setClaudeFrom] = useState('')
  const [tone, setTone] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [imported, setImported] = useState<Imported | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const focusLater = useFocusLater()
  // PostingPage moves focus here once the posting's header is picked.
  const buttonId = `start-${kind}`
  const fromId = `start-from-${kind}`
  const claudeFromId = `start-claude-from-${kind}`
  const sourceId = `start-source-${kind}`
  const errorId = `start-error-${kind}`

  useEffect(() => {
    if (open && !imported) firstRef.current?.focus()
  }, [open, imported])

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
    setImported(null)
    setError(null)
    focusLater(buttonId)
  }

  const toneSetId = tone ? Number(tone) : null

  if (imported) {
    return (
      <ImportReview
        kind={kind}
        imported={imported}
        forPosting
        onSave={(body, tailor) => onStart({ how: 'imported', body, toneSetId, tailor })}
        onCancel={close}
      />
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (how === 'copy' && !from) {
      setError(new ApiError('VALIDATION_FAILED', `Choose a ${singular} to copy.`, 'from', 422))
      focusLater(fromId)
      return
    }
    if (how === 'upload' || how === 'paste') {
      const source = sourceOf(how, file, text, singular)
      if (typeof source === 'string') {
        setError(new ApiError('VALIDATION_FAILED', source, SOURCE_FIELD[how], 422))
        focusLater(sourceId)
        return
      }
      setSaving(true)
      setError(null)
      try {
        setImported(await docsApi(kind).readExisting(source))
      } catch (caught) {
        const failed = toApiError(caught)
        setError(failed)
        if (failed.field === SOURCE_FIELD[how]) focusLater(sourceId)
      } finally {
        setSaving(false)
      }
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onStart(
        how === 'copy'
          ? { how, fromId: Number(from) }
          : how === 'claude'
            ? { how, toneSetId, startFromId: claudeFrom ? Number(claudeFrom) : null }
            : { how, toneSetId },
      )
    } catch (caught) {
      const failed = toApiError(caught)
      setError(failed)
      setSaving(false)
      if (failed.field === 'start_from_id') focusLater(claudeFromId)
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
    { value: 'upload', label: `Upload a ${singular} (PDF or Word)` },
    { value: 'paste', label: `Paste a ${singular}'s text` },
  ]
  const fromError = error?.field === 'from'
  const claudeFromError = error?.field === 'start_from_id'
  // Base versions first, then the ones for postings, named with their organization, each A to Z.
  const startOptions = [...sortByName(bases, nameOf), ...sortByName(tailored, nameOf)].map((doc) => (
    <option key={doc.id} value={doc.id}>
      {nameOf(doc)}
    </option>
  ))
  const reading = how === 'upload' || how === 'paste'
  const sourceError = reading && error?.field === SOURCE_FIELD[how]
  const waiting =
    saving && how === 'claude'
      ? `Claude is tailoring your ${singular}. This can take a few minutes.`
      : saving && reading
        ? `Claude is reading your ${singular}.`
        : ''

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
      {how === 'copy' && (
        <label>
          Start from
          <select
            id={fromId}
            value={from}
            aria-invalid={fromError}
            aria-describedby={fromError ? errorId : undefined}
            onChange={(event) => setFrom(event.target.value)}
          >
            <option value="">Choose a {singular}</option>
            {startOptions}
          </select>
        </label>
      )}
      {how === 'claude' && startOptions.length > 0 && (
        <label>
          Start from
          <select
            id={claudeFromId}
            value={claudeFrom}
            aria-invalid={claudeFromError}
            aria-describedby={claudeFromError ? errorId : undefined}
            onChange={(event) => setClaudeFrom(event.target.value)}
          >
            <option value="">The best fit (Claude picks)</option>
            {startOptions}
          </select>
        </label>
      )}
      {reading && (
        <SourceField
          how={how}
          singular={singular}
          id={sourceId}
          text={text}
          error={error}
          errorId={errorId}
          onFile={setFile}
          onText={setText}
        />
      )}
      {how !== 'copy' && (
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
        <p role="alert" id={fromError || claudeFromError || sourceError ? errorId : undefined}>
          {error.message}
        </p>
      )}
      {/* Always rendered, so screen readers hear it when Claude starts. A plain live region rather
          than role="status", as in OrderedList, so the page's notices stay in AlertDialog. */}
      <p aria-live="polite">{waiting}</p>
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving
            ? how === 'claude'
              ? 'Tailoring…'
              : reading
                ? 'Reading…'
                : 'Starting…'
            : error?.code === 'AI_UNAVAILABLE'
              ? 'Retry'
              : reading
                ? `Read ${singular}`
                : `Start ${singular}`}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  )
}
