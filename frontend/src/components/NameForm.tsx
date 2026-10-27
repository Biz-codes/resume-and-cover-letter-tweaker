// A one-field form for adding or renaming a library item. Keeps the input on errors.
import { useState, type FormEvent } from 'react'
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

  async function submit(event: FormEvent) {
    event.preventDefault()
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

  return (
    <form className="inline-form" onSubmit={submit}>
      {lockedNote && <p className="note">{lockedNote}</p>}
      <label>
        {label}
        <input
          value={name}
          aria-invalid={error?.field === field}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        <button type="submit" disabled={saving}>
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
