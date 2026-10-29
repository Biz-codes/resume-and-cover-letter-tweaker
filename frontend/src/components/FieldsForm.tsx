// A form for a library item with several fields (a role, a project, an education entry). It
// opens in place of a button or card, so focus moves to its first field, and it keeps the input
// on errors, highlighting the field the error names.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toApiError, type ApiError } from '../api/client'

export interface Field<T> {
  name: keyof T & string
  label: string
  required?: boolean
  type?: 'text' | 'url'
  // A textarea, for text longer than a line (an education entry's details).
  multiline?: boolean
}

export default function FieldsForm<T extends { [K in keyof T]: string | null }>({
  label,
  fields,
  initial,
  note,
  submitLabel = 'Save',
  children,
  onSave,
  onCancel,
}: {
  // Names the form, e.g. "Edit "Engineer, Acme"".
  label: string
  fields: Field<T>[]
  initial: T
  // Shown above the fields and read with the first one (e.g. how saving works).
  note?: string
  submitLabel?: string
  // More controls, shown after the fields (e.g. which section lists a new item).
  children?: ReactNode
  onSave: (values: T) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => formRef.current?.querySelector<HTMLElement>('input, textarea')?.focus(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(values)
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  // Focus lands on the first field, past the note, so the note describes that field.
  function describedBy(name: string) {
    const ids = [note && name === fields[0].name ? noteId : null, error?.field === name ? errorId : null]
    return ids.filter(Boolean).join(' ') || undefined
  }

  return (
    <form className="card" ref={formRef} onSubmit={submit} aria-label={label}>
      {note && (
        <p className="note" id={noteId}>
          {note}
        </p>
      )}
      {fields.map(({ name, label: fieldLabel, required, type, multiline }) => {
        const control = {
          name,
          value: values[name] ?? '',
          'aria-required': required || undefined,
          'aria-invalid': error?.field === name,
          'aria-describedby': describedBy(name),
          onChange: (event: { target: { value: string } }) => setValues({ ...values, [name]: event.target.value }),
        }
        return (
          <label key={name}>
            {required ? `${fieldLabel} (required)` : fieldLabel}
            {multiline ? <textarea rows={3} {...control} /> : <input type={type ?? 'text'} {...control} />}
          </label>
        )
      })}
      {children}
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
