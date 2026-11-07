// A one-field form for adding or renaming a library item, or writing a bullet (multiline).
// Keeps the input on errors. A form that can be cancelled (renaming) opens in place of the
// item's title, so focus moves into it.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toApiError, type ApiError } from '../../api/client'
import styles from './NameForm.module.css'

// A name field's suffix, read with the field as its description, since the suffix shown beside it
// ("Base Resume", hidden from screen readers) wouldn't make sense alone. It goes outside the
// field's label, so it isn't read as part of the label too.
export function SuffixNote({ id, suffix }: { id: string; suffix: string }) {
  return (
    <span id={id} className="visually-hidden">
      Followed by "{suffix}".
    </span>
  )
}

export default function NameForm({
  label,
  field,
  initial = '',
  lockedNote,
  submitLabel = 'Save',
  suffix,
  multiline = false,
  focusOnOpen = true,
  children,
  onSave,
  onCancel,
}: {
  label: string
  // The request field, so a VALIDATION_FAILED or DUPLICATE on it highlights the input.
  field: string
  initial?: string
  // Shown above the field and read with it: what saving does (a sent version keeps the original,
  // which resumes and cover letters get the change).
  lockedNote?: string
  submitLabel?: string
  // What the app adds after the name wherever it shows it ("Base Resume"), shown after the field.
  suffix?: string
  // A textarea for text longer than a name, such as a bullet point.
  multiline?: boolean
  // Whether a form that can be cancelled takes focus when it opens. Off for an item's form in its
  // dialog, where the dialog's heading has focus.
  focusOnOpen?: boolean
  // More controls, shown after the field (e.g. which resumes and cover letters get the change).
  children?: ReactNode
  onSave: (name: string) => Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const suffixId = useId()
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const opensInPlace = Boolean(onCancel) && focusOnOpen

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

  const describedBy = [lockedNote && noteId, suffix && suffixId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <form className={styles.form} onSubmit={submit}>
      {lockedNote && (
        <p className="note" id={noteId}>
          {lockedNote}
        </p>
      )}
      <label>
        {label}
        {multiline ? (
          <textarea
            ref={inputRef}
            value={name}
            rows={3}
            aria-required="true"
            aria-invalid={error?.field === field}
            aria-describedby={describedBy}
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          <span className={suffix ? 'suffixed' : undefined}>
            <input
              ref={inputRef}
              value={name}
              aria-required="true"
              aria-invalid={error?.field === field}
              aria-describedby={describedBy}
              onChange={(event) => setName(event.target.value)}
            />
            {suffix && <span aria-hidden="true">{suffix}</span>}
          </span>
        )}
      </label>
      {suffix && <SuffixNote id={suffixId} suffix={suffix} />}
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
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
