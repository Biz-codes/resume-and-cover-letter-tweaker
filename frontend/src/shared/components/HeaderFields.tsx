// A resume's, cover letter's, or job posting's header, one value at a time: each field offers
// every value saved in any header, or a new one typed in (and "None" for all but the name).
// Nothing saves until "Save header" (or Enter), so trying values out never adds headers; saving
// points it at the saved header with exactly these values, or a new one, so no saved header
// changes (docs/FRONTEND_CHECKS.md, "Headers"). "Undo changes" goes back to the saved values.
// With no header yet and a suggestion (a new posting's), it starts from the suggestion and saves
// on "Use this header". Read-only, it lists the values.
import { Fragment, useId, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'
import type { Header, HeaderFields as Fields } from '../api/headers'
import { sortByName } from '../sortByName'

type Field = keyof Fields

const FIELDS: { name: Field; label: string; autoComplete: string }[] = [
  { name: 'full_name', label: 'Name', autoComplete: 'name' },
  { name: 'headline', label: 'Headline', autoComplete: 'organization-title' },
  { name: 'email', label: 'Email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', autoComplete: 'tel' },
  { name: 'location', label: 'Location', autoComplete: 'address-level2' },
  { name: 'linkedin_url', label: 'LinkedIn', autoComplete: 'url' },
  { name: 'github_url', label: 'GitHub', autoComplete: 'url' },
  { name: 'portfolio_url', label: 'Portfolio', autoComplete: 'url' },
]

// The select's value for "None" and for typing a new value. Saved values are their own text.
const NONE = ''
const NEW = '\u0000new'

type Choices = Record<Field, string>

const noneTyped = () => Object.fromEntries(FIELDS.map(({ name }) => [name, ''])) as Record<Field, string>

// The header's values, or the suggested ones: a value no saved header has starts as a new one,
// already typed in.
function starting(header: Header | undefined, headers: Header[], suggested: Fields | undefined) {
  const choices = {} as Choices
  const typed = noneTyped()
  for (const { name } of FIELDS) {
    const value = header?.[name] ?? (header ? null : (suggested?.[name] ?? null))
    if (value === null) {
      choices[name] = name === 'full_name' ? (headers[0]?.full_name ?? NEW) : NONE
    } else if (header || headers.some((item) => item[name] === value)) {
      choices[name] = value
    } else {
      choices[name] = NEW
      typed[name] = value
    }
  }
  return { choices, typed }
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
  const [start] = useState(() => starting(header, headers, suggested))
  const [choices, setChoices] = useState(start.choices)
  const [typed, setTyped] = useState(start.typed)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
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

  // Each value once, in the order the headers come (most recent first), plus the one chosen.
  const saved = (name: Field) => {
    const values = headers.map((item) => item[name]).filter((value): value is string => Boolean(value))
    if (choices[name] !== NONE && choices[name] !== NEW) values.push(choices[name])
    return sortByName([...new Set(values)], (value) => value)
  }

  // Every value as chosen or typed (a new value not typed yet is empty).
  const values = {} as Record<Field, string | null>
  for (const { name } of FIELDS) {
    const choice = choices[name]
    values[name] = choice === NEW ? typed[name].trim() || null : choice === NONE ? null : choice
  }
  // Something differs from the saved header, so there's something to save. A suggestion is
  // always there to use.
  const changed = pending || FIELDS.some(({ name }) => values[name] !== (header?.[name] ?? null))

  function undo() {
    const fresh = starting(header, headers, suggested)
    setChoices(fresh.choices)
    setTyped(fresh.typed)
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || !changed) return
    setSaving(true)
    setError(null)
    try {
      await onSave(values as Fields)
      // What was typed is a saved value now.
      setChoices(Object.fromEntries(FIELDS.map(({ name }) => [name, values[name] ?? NONE])) as Choices)
      setTyped(noneTyped())
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  const invalid = (name: Field) => ({
    'aria-invalid': error?.field === name,
    'aria-describedby': error?.field === name ? errorId : undefined,
  })

  return (
    <form className="stacked-form" onSubmit={submit} aria-label="Header">
      {FIELDS.map(({ name, label, autoComplete }) => {
        const required = name === 'full_name'
        const isNew = choices[name] === NEW
        return (
          <div key={name}>
            <label>
              {required ? `${label} (required)` : label}
              <select
                value={choices[name]}
                aria-required={required || undefined}
                {...(isNew ? {} : invalid(name))}
                onChange={(event) => setChoices({ ...choices, [name]: event.target.value })}
              >
                {!required && <option value={NONE}>None</option>}
                {/* New comes before the saved values, so it's reached without going through them all. */}
                <option value={NEW}>New {label.toLowerCase()}…</option>
                {saved(name).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {isNew && (
              <label>
                New {label.toLowerCase()}
                <input
                  value={typed[name]}
                  autoComplete={autoComplete}
                  aria-required={required || undefined}
                  {...invalid(name)}
                  onChange={(event) => setTyped({ ...typed, [name]: event.target.value })}
                />
              </label>
            )}
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
          <button type="button" aria-disabled={!changed} onClick={() => changed && undo()}>
            Undo changes
          </button>
        )}
      </div>
    </form>
  )
}
