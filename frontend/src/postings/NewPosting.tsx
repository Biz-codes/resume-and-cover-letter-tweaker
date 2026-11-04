// The new job posting form, in two steps (docs/APP_FLOW.md, "Reading the job posting"). First its
// link: Claude reads the posting's page, or the description pasted in, when the page can't be read
// or there isn't one. Then the posting's fields, filled with what Claude found, for the user to
// check and correct. Nothing is saved until "Save posting". "Fill in by hand" skips Claude.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import FieldsForm from '../shared/components/FieldsForm'
import { POSTING_FIELDS, postingsApi, type PostingFields } from './postings'

export default function NewPosting({
  onSave,
  onCancel,
}: {
  onSave: (fields: PostingFields) => Promise<void>
  onCancel: () => void
}) {
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  // The fields to check, once read (or to fill in by hand), and whether Claude filled them.
  const [draft, setDraft] = useState<{ fields: PostingFields; read: boolean } | null>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()

  useEffect(() => urlRef.current?.focus(), [])
  // The box for the description takes focus when it opens.
  useEffect(() => {
    if (pasting) textRef.current?.focus()
  }, [pasting])

  async function read(event: FormEvent) {
    event.preventDefault()
    if (reading) return
    setReading(true)
    setError(null)
    try {
      const found = await postingsApi.read(url, text)
      setDraft({ fields: { url, ...found }, read: true })
    } catch (caught) {
      const failed = toApiError(caught)
      setError(failed)
      if (failed.code === 'POSTING_FETCH_FAILED') {
        if (pasting) textRef.current?.focus()
        else setPasting(true)
      }
    } finally {
      setReading(false)
    }
  }

  if (draft) {
    return (
      <FieldsForm
        label="New job posting"
        fields={POSTING_FIELDS}
        initial={draft.fields}
        note={draft.read ? 'Claude filled these in from the posting. Check them before saving.' : undefined}
        submitLabel="Save posting"
        onSave={onSave}
        onCancel={onCancel}
      />
    )
  }

  const errorFor = (field: string) => ({
    'aria-invalid': error?.field === field,
    'aria-describedby': error?.field === field ? errorId : undefined,
  })
  // A failed fetch's message says to paste the description, so it's read again in its box.
  const fetchFailed = error?.code === 'POSTING_FETCH_FAILED'

  return (
    <form className="card stacked-form" onSubmit={read} aria-label="New job posting">
      <label>
        Link to the posting or primary contact (required)
        <input
          ref={urlRef}
          type="text"
          value={url}
          aria-required="true"
          {...errorFor('url')}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      {pasting && (
        <label>
          Job description
          <textarea
            ref={textRef}
            rows={8}
            value={text}
            aria-describedby={fetchFailed ? errorId : undefined}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while reading. */}
        <button type="submit" aria-disabled={reading}>
          {reading ? 'Reading…' : error?.code === 'AI_UNAVAILABLE' ? 'Retry' : 'Read posting'}
        </button>
        {!pasting && (
          <button type="button" onClick={() => setPasting(true)}>
            Paste the description
          </button>
        )}
        <button
          type="button"
          onClick={() => setDraft({ fields: { url, organization: '', role_title: '', description: text }, read: false })}
        >
          Fill in by hand
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
