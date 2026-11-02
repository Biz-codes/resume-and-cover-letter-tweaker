// Library page for headers: list and add them, and open each one's dialog (ItemDialog) to edit it,
// add a version of it, or delete it, with the version rules from "Headers" and "Sent versions are
// locked" in docs/FRONTEND_CHECKS.md.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { headersApi, type Header, type HeaderFields } from '../shared/api/headers'
import { anyLocked } from '../shared/api/usage'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { distinctLabels } from '../shared/api/labels'

// autoComplete lets browsers fill in the user's own details (WCAG 1.3.5).
const FIELDS: { name: keyof HeaderFields; label: string; type?: string; autoComplete?: string }[] = [
  { name: 'full_name', label: 'Full name (required)', autoComplete: 'name' },
  { name: 'headline', label: 'Headline', autoComplete: 'organization-title' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { name: 'location', label: 'Location' },
  { name: 'linkedin_url', label: 'LinkedIn URL', autoComplete: 'url' },
  { name: 'github_url', label: 'GitHub URL', autoComplete: 'url' },
  { name: 'portfolio_url', label: 'Portfolio URL', autoComplete: 'url' },
]

const EMPTY: HeaderFields = {
  full_name: '',
  headline: null,
  email: null,
  phone: null,
  location: null,
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
}

// Ids of the buttons that open a form or dialog, where focus returns when it closes.
const NEW_HEADER_ID = 'new-header'
const editId = (headerId: number) => `header-${headerId}-edit`

// Names a header in its buttons' labels; several headers can share a name.
const headerLabel = (header: Header) => (header.headline ? `${header.full_name}, ${header.headline}` : header.full_name)

function fieldsOf(header: Header): HeaderFields {
  const { header_id: _id, created_at: _added, used_by: _usedBy, ...fields } = header
  return fields
}

// The header's fields, keeping the input on errors and highlighting the field the error names.
// It opens in place of a button or the item's form, so focus moves to its first field.
function HeaderForm({
  label,
  initial,
  locked = false,
  submitLabel = 'Save',
  onSave,
  onCancel,
}: {
  label: string
  initial: HeaderFields
  locked?: boolean
  submitLabel?: string
  onSave: (fields: HeaderFields) => Promise<void>
  onCancel: () => void
}) {
  const [fields, setFields] = useState(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => formRef.current?.querySelector('input')?.focus(), [])

  // Focus lands on the first field, past the note, so the note describes that field.
  function describedBy(name: keyof HeaderFields) {
    const ids = [
      locked && name === FIELDS[0].name ? noteId : null,
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
      {FIELDS.map(({ name, label: fieldLabel, type, autoComplete }) => (
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

export default function HeadersPage() {
  const [headers, setHeaders] = useState<Header[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  // The header whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Headers')

  const load = useCallback(
    () =>
      headersApi
        .list()
        .then((list) => {
          setHeaders(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function saved(header: Header, message: string) {
    setAdding(false)
    setEditing(null)
    await load()
    setNotice(message)
    focusLater(editId(header.header_id))
  }

  async function create(fields: HeaderFields) {
    const known = new Set(headers?.map((header) => header.header_id))
    const header = await headersApi.create(fields)
    await saved(header, known.has(header.header_id) ? 'An identical header already exists, so no new one was added.' : 'Saved.')
  }

  async function update(original: Header, fields: HeaderFields) {
    const header = await headersApi.update(original.header_id, fields)
    await saved(
      header,
      header.header_id === original.header_id
        ? 'Saved.'
        : 'Saved as a new header. Everything that used the original still uses it.',
    )
  }

  async function addVersion(original: Header, fields: HeaderFields) {
    const known = new Set(headers?.map((header) => header.header_id))
    const header = await headersApi.addVersion(original.header_id, fields)
    await saved(
      header,
      known.has(header.header_id)
        ? 'A header with those values already exists, so no new one was added.'
        : 'Added a new header. Everything keeps the header it uses until you pick the new one.',
    )
  }

  async function confirmDelete(header: Header) {
    setDeleteError(null)
    try {
      await headersApi.delete(header.header_id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice('Header deleted.')
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  // Names that tell versions apart (labels.ts), for the cards and their buttons.
  const labelOf = distinctLabels(headers ?? [], headerLabel, (item) => item.created_at)

  function itemDialog(header: Header) {
    const label = labelOf(header)
    return (
      <ItemDialog
        title={label}
        onClose={() => setEditing(null)}
        form={
          <HeaderForm
            label="Edit header"
            initial={fieldsOf(header)}
            locked={anyLocked(header.used_by)}
            onSave={(fields) => update(header, fields)}
            onCancel={() => setEditing(null)}
          />
        }
        newVersion={(back) => (
          <HeaderForm
            label="New version of the header"
            initial={fieldsOf(header)}
            submitLabel="Add version"
            onSave={(fields) => addVersion(header, fields)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={`"${label}"`}
            uses={header.used_by}
            effect="They keep going with no header until you pick another."
            error={deleteError}
            onConfirm={() => void confirmDelete(header)}
            onCancel={back}
          />
        )}
      >
        <UsedBy uses={header.used_by} />
      </ItemDialog>
    )
  }

  const editingHeader = headers?.find((header) => header.header_id === editing)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Headers
      </h2>
      <p className="muted">
        The name, headline, and contact details at the top of a resume or cover letter.
      </p>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!headers && !loadError && <p>Loading…</p>}

      {adding ? (
        <HeaderForm
          label="New header"
          initial={EMPTY}
          onSave={create}
          onCancel={() => {
            setAdding(false)
            focusLater(NEW_HEADER_ID)
          }}
        />
      ) : (
        headers && (
          <button
            type="button"
            id={NEW_HEADER_ID}
            onClick={() => {
              setAdding(true)
              setNotice(null)
            }}
          >
            New header
          </button>
        )
      )}

      {headers?.length === 0 && <p>No headers yet.</p>}
      {headers?.map((header) => (
        <LibraryCard
          key={header.header_id}
          title={labelOf(header)}
          heading={3}
          editId={editId(header.header_id)}
          editLabel={`Edit "${labelOf(header)}"`}
          onEdit={() => {
            setEditing(header.header_id)
            setDeleteError(null)
            setNotice(null)
          }}
        >
          <p className="muted">{[header.phone, header.email, header.location].filter(Boolean).join(' | ')}</p>
          {[header.linkedin_url, header.github_url, header.portfolio_url]
            .filter(Boolean)
            .map((url) => (
              <p key={url} className="muted">
                {url}
              </p>
            ))}
        </LibraryCard>
      ))}
      {editingHeader && itemDialog(editingHeader)}
    </section>
  )
}
