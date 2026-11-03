// A header's fields and its form, used to add, edit, and add a version of a header.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import type { HeaderFields } from '../../shared/api/headers'
import { HEADER_FIELDS } from './itemFields'


// The header's fields, keeping the input on errors and highlighting the field the error names.
// It opens in place of a button or the item's form, so focus moves to its first field.
export default function HeaderForm({
  label,
  initial,
  locked = false,
  submitLabel = 'Save',
  focusOnOpen = true,
  onSave,
  onCancel,
}: {
  label: string
  initial: HeaderFields
  locked?: boolean
  submitLabel?: string
  // Off for the header's form in its dialog, where the dialog's heading has focus.
  focusOnOpen?: boolean
  onSave: (fields: HeaderFields) => Promise<void>
  onCancel: () => void
}) {
  const [fields, setFields] = useState(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (focusOnOpen) formRef.current?.querySelector('input')?.focus()
  }, [focusOnOpen])

  // Focus lands on the first field, past the note, so the note describes that field.
  function describedBy(name: keyof HeaderFields) {
    const ids = [
      locked && name === HEADER_FIELDS[0].name ? noteId : null,
      error?.field === name ? errorId : null,
    ].filter(Boolean)
    return ids.length ? ids.join(' ') : undefined
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(fields)
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card" ref={formRef} onSubmit={submit} aria-label={label}>
      {locked && (
        <p className="note" id={noteId}>
          A sent version uses this header, so saving adds a new header. Everything using this one keeps it.
        </p>
      )}
      {HEADER_FIELDS.map(({ name, label: fieldLabel, type, autoComplete }) => (
        <label key={name}>
          {fieldLabel}
          <input
            name={name}
            type={type ?? 'text'}
            autoComplete={autoComplete}
            value={fields[name] ?? ''}
            aria-required={name === 'full_name' || undefined}
            aria-invalid={error?.field === name}
            aria-describedby={describedBy(name)}
            onChange={(event) => setFields({ ...fields, [name]: event.target.value })}
          />
        </label>
      ))}
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
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
