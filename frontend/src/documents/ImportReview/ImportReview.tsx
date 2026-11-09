// What Claude read in the user's own resume or cover letter, for the user to check before it's
// saved (docs/APP_FLOW.md, "Starting from an existing resume or cover letter";
// docs/FRONTEND_CHECKS.md, "Reading an existing resume or cover letter"). Each section and item
// has its fields to correct and Remove; one the library doesn't have yet is marked new. Where
// Claude saw a library item that looks like the same thing written differently, "Use the saved
// one" uses that one instead (and back). Nothing is saved until Save; reordering and adding happen
// afterward in the usual tree. A base one has its header here; one for a posting uses the
// posting's, and saves as is or has Claude tailor it from there.
import { useEffect, useId, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { KINDS, type DocKind, type EntryKind } from '../../shared/api/documents'
import type { HeaderFields } from '../../shared/api/headers'
import type { ImportBody, Imported, ImportedItem, ItemIn, Values } from '../../shared/api/imports'
import {
  EDUCATION_FIELDS,
  EMPTY_HEADER,
  EXCERPT_FIELDS,
  HEADER_FIELDS,
  PROJECT_FIELDS,
  ROLE_FIELDS,
} from '../../library/items/itemFields'
import { useFocusLater } from '../../shared/hooks/useFocusLater'

type RowKind = EntryKind | 'section' | 'skill' | 'child_bullet' | 'sign_off'

interface FieldDef {
  name: string
  label: string
  required?: boolean
  multiline?: boolean
  type?: string
}

const asDefs = (fields: { name: string; label: string; required?: boolean; multiline?: boolean; type?: string }[]) =>
  fields.map(({ name, label, required, multiline, type }) => ({ name, label, required, multiline, type }))

const FIELDS: Record<RowKind, FieldDef[]> = {
  section: [{ name: 'title', label: 'Section title', required: true }],
  narrative: asDefs(EXCERPT_FIELDS),
  bullet: [{ name: 'content', label: 'Bullet text', required: true, multiline: true }],
  child_bullet: [{ name: 'content', label: 'Bullet text', required: true, multiline: true }],
  experience: asDefs(ROLE_FIELDS),
  project: asDefs(PROJECT_FIELDS),
  education: asDefs(EDUCATION_FIELDS),
  category: [{ name: 'category_name', label: 'Category name', required: true }],
  skill: [{ name: 'skill_name', label: 'Skill', required: true }],
  sign_off: [{ name: 'text', label: 'Sign-off', required: true }],
}

const KIND_NAMES: Record<EntryKind, string> = {
  narrative: 'Narrative content',
  bullet: 'Bullet',
  experience: 'Role',
  project: 'Project',
  category: 'Skill category',
  education: 'Education',
}

// A row of the form: an item as Claude read it (`original`) and as the user corrected it.
interface Row {
  key: string
  values: Values
  original: Values
  saved: boolean
  similar: ImportedItem['similar']
  // "Use the saved one": the similar library item instead.
  useSaved: boolean
}

interface EntryRow extends Row {
  kind: EntryKind
  skills: Row[]
  bullets: Row[]
}

interface SectionRow extends Row {
  entries: EntryRow[]
}

const same = (a: Values, b: Values) => Object.keys({ ...a, ...b }).every((key) => (a[key] ?? '') === (b[key] ?? ''))

// Added to the library when it's saved: not the saved one the user chose, and not identical to
// one the library has.
const isNew = (row: Row) => !row.useSaved && !(row.saved && same(row.values, row.original))

const short = (text: string | null | undefined) => {
  const words = (text ?? '').split(/\s+/).filter(Boolean)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : words.join(' ')
}

// What a row is called in its legend and buttons.
function rowName(kind: RowKind, row: Row) {
  const values = row.useSaved && row.similar ? null : row.values
  if (!values) return row.similar?.name ?? ''
  switch (kind) {
    case 'experience':
      return [values.role_title, values.organization].filter(Boolean).join(', ')
    case 'project':
      return values.project_title ?? ''
    case 'education':
      return values.degree ?? ''
    case 'category':
      return values.category_name ?? ''
    case 'skill':
      return values.skill_name ?? ''
    case 'section':
      return values.title ?? ''
    case 'sign_off':
      return values.text ?? ''
    default:
      return short(values.content)
  }
}

const firstId = (kind: RowKind, row: Row) => (row.useSaved ? `${row.key}-saved` : `${row.key}-${FIELDS[kind][0].name}`)

function toRows(imported: Imported) {
  let count = 0
  const row = (item: ImportedItem): Row => ({
    key: `import-${++count}`,
    values: { ...item.values },
    original: item.values,
    saved: item.saved,
    similar: item.similar,
    useSaved: false,
  })
  return imported.sections.map(
    (section): SectionRow => ({
      ...row(section),
      entries: section.entries.map((entry) => ({
        ...row(entry),
        kind: entry.kind,
        skills: entry.skills.map(row),
        bullets: entry.bullets.map(row),
      })),
    }),
  )
}

const itemIn = (row: Row): ItemIn =>
  row.useSaved && row.similar ? { item_id: row.similar.id, values: {} } : { item_id: null, values: row.values }

function toBody(sections: SectionRow[]): ImportBody['sections'] {
  return sections.map((section) => ({
    ...itemIn(section),
    entries: section.entries.map((entry) => ({
      ...itemIn(entry),
      kind: entry.kind,
      skills: entry.skills.map(itemIn),
      bullets: entry.bullets.map(itemIn),
    })),
  }))
}

// The first required field left empty, to point to before saving.
function missing(sections: SectionRow[]) {
  const check = (kind: RowKind, row: Row) =>
    row.useSaved ? null : FIELDS[kind].find((field) => field.required && !(row.values[field.name] ?? '').trim())
  for (const section of sections) {
    const field = check('section', section)
    if (field) return `${section.key}-${field.name}`
    for (const entry of section.entries) {
      const entryField = check(entry.kind, entry)
      if (entryField) return `${entry.key}-${entryField.name}`
      for (const [kind, rows] of [
        ['skill', entry.skills],
        ['child_bullet', entry.bullets],
      ] as const) {
        for (const child of rows) {
          const childField = check(kind, child)
          if (childField) return `${child.key}-${childField.name}`
        }
      }
    }
  }
  return null
}

function NewTag({ row }: { row: Row }) {
  return isNew(row) ? <span className="tag">new</span> : null
}

// A row's fields, or the saved one it uses, with the choice between them when Claude saw one.
function RowFields({
  kind,
  row,
  invalid,
  errorId,
  describedBy,
  where,
  onChange,
  onUseSaved,
}: {
  kind: RowKind
  row: Row
  // The id of the field the error is about.
  invalid: string | null
  errorId: string
  // Read with the first field (the form's note).
  describedBy?: string
  // Where the row is ("of Summary"), for screen readers only, since its labels repeat on the form.
  where?: string
  onChange: (values: Values) => void
  onUseSaved: (useSaved: boolean) => void
}) {
  const name = rowName(kind, row)
  return (
    <>
      {!row.useSaved &&
        FIELDS[kind].map((field, index) => {
          const id = `${row.key}-${field.name}`
          const props = {
            id,
            value: row.values[field.name] ?? '',
            'aria-required': field.required ? ('true' as const) : undefined,
            'aria-invalid': invalid === id,
            'aria-describedby':
              [invalid === id ? errorId : null, index === 0 ? describedBy : null].filter(Boolean).join(' ') || undefined,
            onChange: (event: { target: { value: string } }) =>
              onChange({ ...row.values, [field.name]: event.target.value || null }),
          }
          return (
            <label key={field.name}>
              {field.label}
              {field.required && ' (required)'}
              {where && (
                <>
                  {' '}
                  <span className="visually-hidden">{where}</span>
                </>
              )}
              {field.multiline ? <textarea rows={2} {...props} /> : <input type={field.type ?? 'text'} {...props} />}
            </label>
          )
        })}
      {row.similar && (
        <div className="actions">
          <p className="muted">
            {row.useSaved
              ? `Using "${row.similar.name}" from your library.`
              : `Like "${row.similar.name}" in your library.`}
          </p>
          {/* One button whose text changes, so focus stays on it. */}
          <button
            type="button"
            id={`${row.key}-saved`}
            aria-label={
              row.useSaved
                ? `Use what Claude read instead of "${row.similar.name}"`
                : `Use the saved one for "${name}"`
            }
            onClick={() => onUseSaved(!row.useSaved)}
          >
            {row.useSaved ? 'Use what Claude read' : 'Use the saved one'}
          </button>
        </div>
      )}
    </>
  )
}

export default function ImportReview({
  kind,
  imported,
  forPosting,
  onSave,
  onCancel,
}: {
  kind: DocKind
  imported: Imported
  // A posting's: it uses the posting's header, and can have Claude tailor it.
  forPosting: boolean
  onSave: (body: ImportBody, tailor: boolean) => Promise<void>
  onCancel: () => void
}) {
  const { singular } = KINDS[kind]
  const letter = kind === 'cover_letter'
  const [sections, setSections] = useState(() => toRows(imported))
  const [header, setHeader] = useState<HeaderFields>(imported.header ?? EMPTY_HEADER)
  const [addressee, setAddressee] = useState(imported.addressee ?? '')
  const [signOff, setSignOff] = useState<Row | null>(() =>
    imported.sign_off
      ? {
          key: 'import-sign-off',
          values: { ...imported.sign_off.values },
          original: imported.sign_off.values,
          saved: imported.sign_off.saved,
          similar: null,
          useSaved: false,
        }
      : null,
  )
  const [signature, setSignature] = useState(imported.signature_name ?? '')
  const [error, setError] = useState<ApiError | null>(null)
  // The empty required field the error is about.
  const [invalid, setInvalid] = useState<string | null>(null)
  const [saving, setSaving] = useState<'as_is' | 'tailor' | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const focusLater = useFocusLater()
  const noteId = useId()
  const errorId = useId()
  const headerNew = !imported.header_saved || !same({ ...header }, { ...(imported.header ?? EMPTY_HEADER) })

  const updateSection = (index: number, change: (section: SectionRow) => SectionRow) =>
    setSections((current) => current.map((section, at) => (at === index ? change(section) : section)))
  const updateEntry = (si: number, ei: number, change: (entry: EntryRow) => EntryRow) =>
    updateSection(si, (section) => ({
      ...section,
      entries: section.entries.map((entry, at) => (at === ei ? change(entry) : entry)),
    }))

  function edited(id: string) {
    if (invalid === id) setInvalid(null)
  }

  function withSaved<T extends Row>(row: T, value: boolean): T {
    setAnnouncement(value ? `Using "${row.similar?.name}" from your library.` : 'Using what Claude read.')
    return { ...row, useSaved: value }
  }

  // After a row is removed, focus goes to the next one in its list, or the one before, or the
  // row it was under, so it never stays on a removed button.
  function removed(name: string, next: string) {
    setAnnouncement(`Removed ${name}.`)
    focusLater(next)
  }

  function removeSection(si: number) {
    const section = sections[si]
    const after = sections[si + 1] ?? sections[si - 1]
    setSections((current) => current.filter((_, at) => at !== si))
    removed(`section "${rowName('section', section)}"`, after ? firstId('section', after) : 'import-save')
  }

  function removeEntry(si: number, ei: number) {
    const section = sections[si]
    const entry = section.entries[ei]
    const after = section.entries[ei + 1] ?? section.entries[ei - 1]
    updateSection(si, (current) => ({ ...current, entries: current.entries.filter((_, at) => at !== ei) }))
    removed(`"${rowName(entry.kind, entry) || KIND_NAMES[entry.kind]}"`, after ? firstId(after.kind, after) : firstId('section', section))
  }

  function removeChild(si: number, ei: number, list: 'skills' | 'bullets', ci: number) {
    const entry = sections[si].entries[ei]
    const rows = entry[list]
    const kind = list === 'skills' ? 'skill' : 'child_bullet'
    const after = rows[ci + 1] ?? rows[ci - 1]
    updateEntry(si, ei, (current) => ({ ...current, [list]: current[list].filter((_, at) => at !== ci) }))
    removed(`"${rowName(kind, rows[ci])}"`, after ? firstId(kind, after) : firstId(entry.kind, entry))
  }

  async function save(tailor: boolean) {
    if (saving) return
    const empty = missing(sections) ?? (signOff && !(signOff.values.text ?? '').trim() ? `${signOff.key}-text` : null)
    if (empty) {
      setInvalid(empty)
      setError(null)
      focusLater(empty)
      return
    }
    setInvalid(null)
    setError(null)
    setSaving(tailor ? 'tailor' : 'as_is')
    if (tailor) setAnnouncement(`Claude is tailoring your ${singular}. This can take a few minutes.`)
    try {
      await onSave(
        {
          header: !forPosting && header.full_name.trim() ? header : null,
          sections: toBody(sections),
          addressee: letter ? addressee.trim() || null : null,
          sign_off: letter && signOff ? itemIn(signOff) : null,
          signature_name: letter ? signature.trim() || null : null,
        },
        tailor,
      )
    } catch (caught) {
      setError(toApiError(caught))
      setAnnouncement('')
      setSaving(null)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  const rowProps = { invalid, errorId }
  // The form's first field, which takes focus when it opens and is read with the note.
  const firstField = !forPosting
    ? 'import-header-full_name'
    : letter
      ? 'import-addressee'
      : sections[0]
        ? firstId('section', sections[0])
        : 'import-save'
  const [opening] = useState(firstField)
  useEffect(() => document.getElementById(opening)?.focus(), [opening])

  return (
    <form className="card stacked-form import-review" onSubmit={submit} aria-label={`Check the ${singular} Claude read`}>
      <p className="note" id={noteId}>
        Claude read these from your {singular}. Items marked new are added to your library when you save.
      </p>
      {!forPosting && (
        <fieldset>
          <legend>
            Header {headerNew && header.full_name.trim() && <span className="tag">new</span>}
          </legend>
          {HEADER_FIELDS.map(({ name, label, type, autoComplete }, index) => (
            <label key={name}>
              {/* Optional here: left empty, it uses the most recently used header. */}
              {label.replace(' (required)', '')}
              <input
                id={`import-header-${name}`}
                type={type ?? 'text'}
                autoComplete={autoComplete}
                value={header[name] ?? ''}
                aria-describedby={index === 0 ? noteId : undefined}
                onChange={(event) => setHeader({ ...header, [name]: event.target.value || (name === 'full_name' ? '' : null) })}
              />
            </label>
          ))}
        </fieldset>
      )}
      {letter && (
        <fieldset>
          <legend>Greeting and sign-off</legend>
          <label>
            Greeting, after &ldquo;Dear&rdquo;
            <input
              id="import-addressee"
              value={addressee}
              aria-describedby={forPosting ? noteId : undefined}
              onChange={(event) => setAddressee(event.target.value)}
            />
          </label>
          {signOff && (
            <fieldset>
              <legend>
                Sign-off <NewTag row={signOff} />
              </legend>
              <RowFields
                kind="sign_off"
                row={signOff}
                {...rowProps}
                onChange={(values) => {
                  edited(`${signOff.key}-text`)
                  setSignOff({ ...signOff, values })
                }}
                onUseSaved={() => undefined}
              />
            </fieldset>
          )}
          <label>
            Name under the sign-off
            <input value={signature} onChange={(event) => setSignature(event.target.value)} />
          </label>
        </fieldset>
      )}
      {sections.length === 0 && <p>No sections left.</p>}
      {sections.map((section, si) => {
        const title = rowName('section', section) || 'Untitled section'
        return (
          <fieldset key={section.key} className="import-section">
            <legend>
              Section: {title} <NewTag row={section} />
            </legend>
            <RowFields
              kind="section"
              where={`of ${title}`}
              row={section}
              {...rowProps}
              describedBy={firstField === firstId('section', section) ? noteId : undefined}
              onChange={(values) => {
                edited(`${section.key}-title`)
                updateSection(si, (current) => ({ ...current, values }))
              }}
              onUseSaved={(value) => updateSection(si, (current) => withSaved(current, value))}
            />
            <div className="actions">
              <button type="button" aria-label={`Remove section "${title}"`} onClick={() => removeSection(si)}>
                Remove section
              </button>
            </div>
            {section.entries.length > 0 && (
              <ul className="import-entries">
                {section.entries.map((entry, ei) => {
                  const name = rowName(entry.kind, entry) || KIND_NAMES[entry.kind]
                  const textKind = entry.kind === 'narrative' || entry.kind === 'bullet'
                  return (
                    <li key={entry.key}>
                      <fieldset>
                        <legend>
                          {textKind ? KIND_NAMES[entry.kind] : `${KIND_NAMES[entry.kind]}: ${name}`} <NewTag row={entry} />
                        </legend>
                        <RowFields
                          kind={entry.kind}
                          where={textKind ? `in ${title}` : `of ${name}`}
                          row={entry}
                          {...rowProps}
                          onChange={(values) => {
                            for (const field of FIELDS[entry.kind]) edited(`${entry.key}-${field.name}`)
                            updateEntry(si, ei, (current) => ({ ...current, values }))
                          }}
                          onUseSaved={(value) => updateEntry(si, ei, (current) => withSaved(current, value))}
                        />
                        <div className="actions">
                          <button type="button" aria-label={`Remove "${name}" from ${title}`} onClick={() => removeEntry(si, ei)}>
                            Remove
                          </button>
                        </div>
                        {(['skills', 'bullets'] as const).map((list) => {
                          const rows = entry[list]
                          if (rows.length === 0) return null
                          const childKind = list === 'skills' ? 'skill' : 'child_bullet'
                          return (
                            <fieldset key={list}>
                              <legend>
                                {list === 'skills' ? 'Skills' : 'Bullets'} of {name}
                              </legend>
                              <ul className="import-entries">
                                {rows.map((child, ci) => {
                                  const childName = rowName(childKind, child)
                                  return (
                                    <li key={child.key}>
                                      <RowFields
                                        kind={childKind}
                                        where={list === 'skills' ? `in ${name}` : `under ${name}`}
                                        row={child}
                                        {...rowProps}
                                        onChange={(values) => {
                                          edited(`${child.key}-${FIELDS[childKind][0].name}`)
                                          updateEntry(si, ei, (current) => ({
                                            ...current,
                                            [list]: current[list].map((one, at) => (at === ci ? { ...one, values } : one)),
                                          }))
                                        }}
                                        onUseSaved={(value) =>
                                          updateEntry(si, ei, (current) => ({
                                            ...current,
                                            [list]: current[list].map((one, at) =>
                                              at === ci ? withSaved(one, value) : one,
                                            ),
                                          }))
                                        }
                                      />
                                      <div className="actions">
                                        <NewTag row={child} />
                                        <button
                                          type="button"
                                          aria-label={`Remove "${childName}" from ${name}`}
                                          onClick={() => removeChild(si, ei, list, ci)}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                            </fieldset>
                          )
                        })}
                      </fieldset>
                    </li>
                  )
                })}
              </ul>
            )}
          </fieldset>
        )
      })}
      {/* A plain live region, as in OrderedList, so the page's notices stay in AlertDialog. */}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      {invalid && (
        <p role="alert" id={errorId}>
          Fill this in, or remove it.
        </p>
      )}
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" id="import-save" aria-disabled={saving !== null}>
          {saving === 'as_is' ? 'Saving…' : forPosting ? 'Save as is' : `Save ${singular}`}
        </button>
        {forPosting && (
          <button type="button" aria-disabled={saving !== null} onClick={() => void save(true)}>
            {saving === 'tailor' ? 'Tailoring…' : 'Save, then Claude tailors it'}
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
