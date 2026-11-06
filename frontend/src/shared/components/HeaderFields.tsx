// A resume's, cover letter's, or job posting's header, one value at a time: each field shows its
// current value under its name, then "More [field] options", which offers every other value saved
// in any header and "None" (for all but the name), then a "New [field]" button, which opens a
// small modal to type one in; Apply there puts it in the form. Each change is announced ("Location
// changed to Boston, MA"). Nothing saves until "Save header" (or Enter), so
// trying values out never adds headers; saving points it at the saved header with exactly these
// values, or a new one, so no saved header changes (docs/FRONTEND_CHECKS.md, "Headers"). "Undo
// changes" goes back to the saved values. With no header yet and a suggestion (a new posting's),
// it starts from the suggestion and saves on "Use this header". Read-only, it lists the values.
import { Fragment, useId, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'
import type { Header, HeaderFields as Fields } from '../api/headers'
import { sortByName } from '../sortByName'
import Dialog from './Dialog/Dialog'

type Field = keyof Fields

// `lower` names the field mid-sentence ("More headline options").
const FIELDS: { name: Field; label: string; lower: string; autoComplete: string }[] = [
  { name: 'full_name', label: 'Name', lower: 'name', autoComplete: 'name' },
  { name: 'headline', label: 'Headline', lower: 'headline', autoComplete: 'organization-title' },
  { name: 'email', label: 'Email', lower: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', lower: 'phone', autoComplete: 'tel' },
  { name: 'location', label: 'Location', lower: 'location', autoComplete: 'address-level2' },
  { name: 'linkedin_url', label: 'LinkedIn', lower: 'LinkedIn', autoComplete: 'url' },
  { name: 'github_url', label: 'GitHub', lower: 'GitHub', autoComplete: 'url' },
  { name: 'portfolio_url', label: 'Portfolio', lower: 'portfolio', autoComplete: 'url' },
]

// The dropdown's choices besides the saved values, which are their own text. Picking one applies
// it to the value shown above. The dropdown shows the pick while it has focus, so arrow keys
// (which change a closed dropdown's choice on some systems) move through the options, then goes
// back to "Choose…".
const CHOOSE = ''
const NONE = '\u0000none'

type Values = Record<Field, string | null>

// The header's values, or the suggested ones.
function starting(header: Header | undefined, suggested: Fields | undefined): Values {
  const values = {} as Values
  for (const { name } of FIELDS) values[name] = header ? header[name] : (suggested?.[name] ?? null)
  return values
}

export default function HeaderFields({
  header,
  headers,
  suggested,
  readOnly,
  onSave,
}: {
  // The document's or posting's header, if it has one.
  header: Header | undefined
  // Every saved header, most recently updated first, whose values each field offers.
  headers: Header[]
  // With no header yet: the values to start from (a posting's suggestion), saved with "Use this
  // header".
  suggested?: Fields
  readOnly: boolean
  onSave: (fields: Fields) => Promise<void>
}) {
  const [values, setValues] = useState(() => starting(header, suggested))
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  // The field whose new value is being typed in the modal.
  const [adding, setAdding] = useState<(typeof FIELDS)[number] | null>(null)
  // What the focused dropdown shows, until focus leaves it.
  const [picked, setPicked] = useState<{ field: Field; choice: string } | null>(null)
  // The last change, for screen readers.
  const [announcement, setAnnouncement] = useState('')
  const id = useId()
  const errorId = `${id}-error`
  const pending = !header && Boolean(suggested)

  if (readOnly) {
    if (!header) return <p>No header.</p>
    return (
      <dl className="details-list">
        {FIELDS.map(({ name, label }) => (
          <Fragment key={name}>
            <dt>{label}</dt>
            <dd>{header[name] ?? 'None'}</dd>
          </Fragment>
        ))}
      </dl>
    )
  }

  // Each other saved value once, A to Z.
  const others = (name: Field) =>
    sortByName(
      [...new Set(headers.map((item) => item[name]).filter((value): value is string => Boolean(value)))].filter(
        (value) => value !== values[name],
      ),
      (value) => value,
    )

  // Something differs from the saved header, so there's something to save. A suggestion is
  // always there to use.
  const changed = pending || FIELDS.some(({ name }) => values[name] !== (header?.[name] ?? null))

  // `later`: a change applied in the modal is said once the modal has closed and the page can be
  // heard again.
  function change(field: (typeof FIELDS)[number], value: string | null, later = false) {
    setValues({ ...values, [field.name]: value })
    const text = `${field.label} changed to ${value ?? 'None'}.`
    if (later) setTimeout(() => setAnnouncement(text), 100)
    else setAnnouncement(text)
  }

  function pick(field: (typeof FIELDS)[number], choice: string) {
    setPicked({ field: field.name, choice })
    if (choice !== CHOOSE) change(field, choice === NONE ? null : choice)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || !changed) return
    setSaving(true)
    setError(null)
    try {
      // An empty name is sent as is, for the backend to refuse (VALIDATION_FAILED).
      await onSave(values as Fields)
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <form className="stacked-form" onSubmit={submit} aria-label="Header">
        {/* Always rendered, so each change is announced. */}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
        {FIELDS.map((field) => {
          const { name, label, lower } = field
          const valueId = `${id}-${name}`
          const invalid = error?.field === name
          // The pick stays shown while the dropdown has focus, so it's in the options too.
          const shown = picked?.field === name ? picked.choice : CHOOSE
          const extra = shown !== CHOOSE && shown !== NONE ? [shown] : []
          const saved = sortByName([...new Set([...others(name), ...extra])], (value) => value)
          const noneOffered = name !== 'full_name' && (values[name] !== null || shown === NONE)
          return (
            <div key={name}>
              <p>
                <strong>{label}</strong>
                <br />
                <span id={valueId}>{values[name] ?? 'None'}</span>
              </p>
              {/* Only when there's something else to pick. */}
              {(noneOffered || saved.length > 0) && (
                <label>
                  More {lower} options
                  <select
                    value={shown}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `${valueId} ${errorId}` : valueId}
                    onChange={(event) => pick(field, event.target.value)}
                    onBlur={() => setPicked(null)}
                  >
                    <option value={CHOOSE}>Choose…</option>
                    {noneOffered && <option value={NONE}>None</option>}
                    {saved.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="actions">
                <button
                  type="button"
                  aria-describedby={invalid ? errorId : undefined}
                  onClick={() => setAdding(field)}
                >
                  New {lower}
                </button>
              </div>
            </div>
          )
        })}
        {error && (
          <p role="alert" id={errorId}>
            {error.message}
          </p>
        )}
        <div className="actions">
          {/* aria-disabled, not disabled, so a focused button keeps focus while saving, and after
              saving, when there's nothing left to save. */}
          <button type="submit" aria-disabled={saving || !changed}>
            {saving ? 'Saving…' : pending ? 'Use this header' : 'Save header'}
          </button>
          {!pending && (
            <button
              type="button"
              aria-disabled={!changed}
              onClick={() => {
                if (!changed) return
                setValues(starting(header, suggested))
                setError(null)
                setAnnouncement('Undid the header changes.')
              }}
            >
              Undo changes
            </button>
          )}
        </div>
      </form>
      {adding && (
        <NewValue
          field={adding}
          onApply={(value) => {
            change(adding, value, true)
            setAdding(null)
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}

// The small modal for typing a field's new value. Apply puts it in the header's form; nothing
// saves until "Save header". When it closes, focus goes back to the field's "New" button.
function NewValue({
  field,
  onApply,
  onClose,
}: {
  field: (typeof FIELDS)[number]
  onApply: (value: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [empty, setEmpty] = useState(false)
  const errorId = useId()

  function apply(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (value) onApply(value)
    else setEmpty(true)
  }

  return (
    <Dialog title={`New ${field.lower}`} onClose={onClose}>
      <form className="stacked-form" onSubmit={apply}>
        <label>
          {field.label}
          <input
            value={text}
            autoComplete={field.autoComplete}
            aria-required="true"
            aria-invalid={empty}
            aria-describedby={empty ? errorId : undefined}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {empty && (
          <p role="alert" id={errorId}>
            Type the new {field.lower}.
          </p>
        )}
        <div className="actions">
          <button type="submit">Apply</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
