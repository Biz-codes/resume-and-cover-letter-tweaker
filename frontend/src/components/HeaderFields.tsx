// A resume's or cover letter's header, one value at a time: each field offers every value saved
// in any header, or a new one typed in (and "None" for all but the name). Each change saves right
// away (a typed value when the user leaves its field or presses Enter), pointing the document at
// the saved header with exactly these values, or a new one, so no saved header changes
// (docs/FRONTEND_CHECKS.md, "Headers"). Read-only, it lists the values.
import { Fragment, useId, useState } from 'react'
import { toApiError, type ApiError } from '../api/client'
import type { Header, HeaderFields as Fields } from '../api/headers'

type Field = keyof Fields

const FIELDS: { name: Field; label: string; autoComplete: string }[] = [
  { name: 'full_name', label: 'Name', autoComplete: 'name' },
  { name: 'headline', label: 'Headline', autoComplete: 'off' },
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

function startingChoices(header: Header | undefined, headers: Header[]): Choices {
  const choices = {} as Choices
  for (const { name } of FIELDS) {
    const value = header?.[name] ?? null
    choices[name] = value ?? (name === 'full_name' ? (headers[0]?.full_name ?? NEW) : NONE)
  }
  return choices
}

export default function HeaderFields({
  header,
  headers,
  readOnly,
  onSave,
}: {
  // The document's header, if it has one.
  header: Header | undefined
  // Every saved header, most recently updated first, whose values each field offers.
  headers: Header[]
  readOnly: boolean
  onSave: (fields: Fields) => Promise<void>
}) {
  const [choices, setChoices] = useState(() => startingChoices(header, headers))
  const [typed, setTyped] = useState<Record<Field, string>>(
    () => Object.fromEntries(FIELDS.map(({ name }) => [name, ''])) as Record<Field, string>,
  )
  const [error, setError] = useState<ApiError | null>(null)
  const errorId = useId()
  const hintId = useId()

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
    return [...new Set(values)]
  }

  // Saves one field's new value with the others as chosen. A field waiting for a new value that
  // hasn't been typed yet keeps what the header has.
  async function save(changed: Field, value: string | null) {
    const values = {} as Record<Field, string | null>
    for (const { name } of FIELDS) {
      const choice = choices[name]
      const typedValue = typed[name].trim()
      if (name === changed) values[name] = value
      else if (choice === NEW) values[name] = typedValue || (header?.[name] ?? null)
      else values[name] = choice === NONE ? null : choice
    }
    setError(null)
    try {
      await onSave(values as Fields)
      // What was typed is a saved value now.
      setChoices((current) => ({ ...current, [changed]: value ?? NONE }))
      setTyped((current) => ({ ...current, [changed]: '' }))
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  function choose(name: Field, choice: string) {
    setChoices({ ...choices, [name]: choice })
    // A new value saves once it's typed.
    if (choice !== NEW) void save(name, choice === NONE ? null : choice)
  }

  // A typed value saves when the user leaves the field or presses Enter.
  function commit(name: Field) {
    const value = typed[name].trim()
    if (value) void save(name, value)
  }

  const invalid = (name: Field) => ({
    'aria-invalid': error?.field === name,
    'aria-describedby': error?.field === name ? errorId : undefined,
  })

  return (
    <div className="stacked-form" role="group" aria-label="Header" aria-describedby={hintId}>
      <p className="muted" id={hintId}>
        Each choice saves right away. A new value saves when you leave its field or press Enter.
      </p>
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
                onChange={(event) => choose(name, event.target.value)}
              >
                {!required && <option value={NONE}>None</option>}
                {saved(name).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
                <option value={NEW}>New {label.toLowerCase()}…</option>
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
                  onBlur={() => commit(name)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit(name)
                  }}
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
    </div>
  )
}
