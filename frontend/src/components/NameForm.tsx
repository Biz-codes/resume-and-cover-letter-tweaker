// A one-field form for adding or renaming a library item. Keeps the input on errors. A form
// that can be cancelled (renaming) opens in place of the item's title, so focus moves into it.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'

export default function NameForm({
  label,
  field,
  initial = '',
  lockedNote,
  submitLabel = 'Save',
  onSave,
  onCancel,
}: {
  label: string
  // The request field, so a VALIDATION_FAILED or DUPLICATE on it highlights the input.
  field: string
  initial?: string
  // Shown when a sent version uses the item, so saving makes a new version.
  lockedNote?: string
  submitLabel?: string
  onSave: (name: string) => Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const opensInPlace = Boolean(onCancel)

  useEffect(() => {
    if (opensInPlace) inputRef.current?.focus()
  }, [opensInPlace])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(name)
      if (!initial) setName('')
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  const describedBy = [lockedNote && noteId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <form className="inline-form" onSubmit={submit}>
      {lockedNote && (
        <p className="note" id={noteId}>
          {lockedNote}
        </p>
      )}
      <label>
        {label}
        <input
          ref={inputRef}
          value={name}
          aria-required="true"
          aria-invalid={error?.field === field}
          aria-describedby={describedBy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
