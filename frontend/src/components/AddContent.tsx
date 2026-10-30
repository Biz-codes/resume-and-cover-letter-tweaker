// Adding content to one of a document's sections: first the type of content (a role, project,
// skill category, education entry, bullet, or narrative content), then a saved item of that type
// (the ones the library lists under the section first), or a new one typed into that type's own
// fields, which saves it to the library under the section too. A saved role, project, or skill
// category comes with its default bullets and skills (the backend's app/defaults.py), which the
// tree then changes. The type starts as the kind the library lists most under the section
// (treeItems.ts, defaultKind). An empty section shows the
// form right away; otherwise it opens from its button, and focus moves into it and back.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'
import type { EntryKind, NewItem, TreeSection } from '../api/documents'
import { useFocusLater } from '../hooks/useFocusLater'
import {
  defaultKind,
  KIND_NAMES,
  KINDS_IN_ORDER,
  listedIds,
  NEW_FIELDS,
  placedItem,
  savedItems,
  type Library,
} from './treeItems'

// The item picker's value for typing a new item. Saved items are their ids.
const NEW = 'new'

export default function AddContent({
  section,
  library,
  onAdd,
  onWrite,
}: {
  section: TreeSection
  library: Library
  // A saved item, placed last in the section, with its default skills and bullets.
  onAdd: (kind: EntryKind, itemId: number) => Promise<void>
  // A new item, saved to the library and placed last in the section.
  onWrite: (item: NewItem) => Promise<void>
}) {
  const empty = section.entries.length === 0
  const [open, setOpen] = useState(empty)
  const [kind, setKind] = useState<EntryKind | ''>(() => defaultKind(library, section.section_id) ?? '')
  const [choice, setChoice] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  // Focus moves into the form only when the user opened it.
  const [focusType, setFocusType] = useState(false)
  const typeRef = useRef<HTMLSelectElement>(null)
  const errorId = useId()
  const focusLater = useFocusLater()
  const buttonId = `add-content-${section.row_id}`

  useEffect(() => {
    if (focusType) typeRef.current?.focus()
  }, [focusType])

  function close() {
    setOpen(false)
    setFocusType(false)
    setError(null)
    focusLater(buttonId)
  }

  function reset(nextKind: EntryKind | '') {
    setKind(nextKind)
    setChoice('')
    setValues({})
    setError(null)
  }

  if (!open) {
    return (
      <div className="actions">
        <button
          type="button"
          id={buttonId}
          onClick={() => {
            setOpen(true)
            setFocusType(true)
          }}
        >
          Add content to {section.title}
        </button>
      </div>
    )
  }

  const names = kind ? KIND_NAMES[kind] : null
  // Saved items of the type not already placed here: the section's own list first.
  const placed = new Set(section.entries.map((entry) => placedItem(entry).id))
  const available = kind ? savedItems(library, kind).filter((item) => !placed.has(`${kind}:${item.id}`)) : []
  const listed = kind ? listedIds(library, section.section_id, kind) : []
  const first = listed.flatMap((id) => available.filter((item) => item.id === id))
  const rest = available.filter((item) => !listed.includes(item.id))
  const writing = choice === NEW && kind !== ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || !kind || !choice) return
    setSaving(true)
    setError(null)
    try {
      if (choice === NEW) await onWrite({ kind, ...values })
      else await onAdd(kind, Number(choice))
      reset(kind)
      close()
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  const invalid = (field: string) => ({
    'aria-invalid': error?.field === field,
    'aria-describedby': error?.field === field ? errorId : undefined,
  })

  return (
    <form className="stacked-form add-content" onSubmit={submit} aria-label={`Add content to ${section.title}`}>
      <label>
        Type of content
        <select ref={typeRef} value={kind} onChange={(event) => reset(event.target.value as EntryKind | '')}>
          <option value="">Choose a type…</option>
          {KINDS_IN_ORDER.map((option) => (
            <option key={option} value={option}>
              {KIND_NAMES[option].type}
            </option>
          ))}
        </select>
      </label>
      {names && (
        <label>
          {names.type}
          <select value={choice} {...invalid('item_id')} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Choose a {names.lower}…</option>
            {first.length > 0 && (
              <optgroup label={`Listed under ${section.title}`}>
                {first.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            )}
            {rest.length > 0 && (
              <optgroup label={first.length > 0 ? 'Others' : 'Saved'}>
                {rest.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW}>New {names.lower}…</option>
          </select>
        </label>
      )}
      {writing && (
        <fieldset>
          <legend>New {names?.lower}</legend>
          <p className="muted">It's saved to your library, listed under {section.title}, and placed last here.</p>
          {NEW_FIELDS[kind].map((field) => {
            const control = {
              value: values[field.name] ?? '',
              'aria-required': field.required || undefined,
              ...invalid(field.name),
              onChange: (event: { target: { value: string } }) =>
                setValues({ ...values, [field.name]: event.target.value }),
            }
            return (
              <label key={field.name}>
                {field.required ? `${field.label} (required)` : field.label}
                {field.multiline ? <textarea rows={3} {...control} /> : <input type={field.type ?? 'text'} {...control} />}
              </label>
            )
          })}
        </fieldset>
      )}
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving || !kind || !choice}>
          {saving ? 'Saving…' : `Add to ${section.title}`}
        </button>
        {!empty && (
          <button type="button" onClick={close}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
