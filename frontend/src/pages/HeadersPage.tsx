// Library page for headers: list, add, edit, and delete, with the version rules from
// "Headers" and "Sent versions are locked" in docs/FRONTEND_CHECKS.md.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'
import { headersApi, type Header, type HeaderFields } from '../api/headers'
import { anyLocked } from '../api/usage'
import ConfirmDelete from '../components/ConfirmDelete'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

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

type Editing = { headerId: number | null; fields: HeaderFields }

// Ids of the buttons that open a form, where focus returns when it closes.
const NEW_HEADER_ID = 'new-header'
const buttonId = (headerId: number, action: 'edit' | 'delete') => `header-${headerId}-${action}`

// Names a header in its buttons' labels; several headers can share a name.
const headerLabel = (header: Header) => (header.headline ? `${header.full_name}, ${header.headline}` : header.full_name)

function fieldsOf(header: Header): HeaderFields {
  const { header_id: _id, used_by: _usedBy, ...fields } = header
  return fields
}

function HeaderForm({
  editing,
  locked,
  error,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  editing: Editing
  locked: boolean
  error: ApiError | null
  saving: boolean
  onChange: (fields: HeaderFields) => void
  onSave: () => void
  onCancel: () => void
}) {
  const errorId = useId()
  const noteId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  // The form opens in place of a button or card, so focus moves to its first field.
  useEffect(() => formRef.current?.querySelector('input')?.focus(), [])

  // Focus lands on the first field, past the note, so the note describes that field.
  function describedBy(name: keyof HeaderFields) {
    const ids = [
      locked && name === FIELDS[0].name ? noteId : null,
      error?.field === name ? errorId : null,
    ].filter(Boolean)
    return ids.length ? ids.join(' ') : undefined
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!saving) onSave()
  }

  return (
    <form
      className="card"
      ref={formRef}
      onSubmit={submit}
      aria-label={editing.headerId ? 'Edit header' : 'New header'}
    >
      {locked && (
        <p className="note" id={noteId}>
          A sent version uses this header, so your changes will be saved as a new header.
          Everything that uses this one keeps it; pick the new header where you want it.
        </p>
      )}
      {FIELDS.map(({ name, label, type, autoComplete }) => (
        <label key={name}>
          {label}
          <input
            name={name}
            type={type ?? 'text'}
            autoComplete={autoComplete}
            value={editing.fields[name] ?? ''}
            aria-required={name === 'full_name' || undefined}
            aria-invalid={error?.field === name}
            aria-describedby={describedBy(name)}
            onChange={(event) => onChange({ ...editing.fields, [name]: event.target.value })}
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
          {saving ? 'Saving…' : 'Save'}
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
  const [editing, setEditing] = useState<Editing | null>(null)
  const [formError, setFormError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Header | null>(null)
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

  function startEditing(next: Editing) {
    setEditing(next)
    setFormError(null)
    setNotice(null)
    setDeleting(null)
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    setFormError(null)
    const known = new Set(headers?.map((header) => header.header_id))
    try {
      const saved =
        editing.headerId === null
          ? await headersApi.create(editing.fields)
          : await headersApi.update(editing.headerId, editing.fields)
      if (editing.headerId === null && known.has(saved.header_id)) {
        setNotice('An identical header already exists, so no new one was added.')
      } else if (editing.headerId !== null && saved.header_id !== editing.headerId) {
        setNotice('Saved as a new header. Everything that used the original still uses it.')
      } else {
        setNotice('Saved.')
      }
      setEditing(null)
      await load()
      focusLater(buttonId(saved.header_id, 'edit'))
    } catch (error) {
      setFormError(toApiError(error))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteError(null)
    try {
      await headersApi.delete(deleting.header_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice('Header deleted.')
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  const editedHeader = headers?.find((header) => header.header_id === editing?.headerId)

  function cancelEditing() {
    focusLater(editing?.headerId ? buttonId(editing.headerId, 'edit') : NEW_HEADER_ID)
    setEditing(null)
  }

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

      {editing?.headerId === null ? (
        <HeaderForm
          editing={editing}
          locked={false}
          error={formError}
          saving={saving}
          onChange={(fields) => setEditing({ ...editing, fields })}
          onSave={() => void save()}
          onCancel={cancelEditing}
        />
      ) : (
        headers && (
          <button type="button" id={NEW_HEADER_ID} onClick={() => startEditing({ headerId: null, fields: EMPTY })}>
            New header
          </button>
        )
      )}

      {headers?.length === 0 && <p>No headers yet.</p>}
      {headers?.map((header) =>
        editing?.headerId === header.header_id ? (
          <HeaderForm
            key={header.header_id}
            editing={editing}
            locked={anyLocked(editedHeader?.used_by ?? [])}
            error={formError}
            saving={saving}
            onChange={(fields) => setEditing({ ...editing, fields })}
            onSave={() => void save()}
            onCancel={cancelEditing}
          />
        ) : (
          <article key={header.header_id} className="card">
            <h3>{header.full_name}</h3>
            {header.headline && <p>{header.headline}</p>}
            <p className="muted">
              {[header.phone, header.email, header.location].filter(Boolean).join(' | ')}
            </p>
            {[header.linkedin_url, header.github_url, header.portfolio_url]
              .filter(Boolean)
              .map((url) => (
                <p key={url} className="muted">
                  {url}
                </p>
              ))}
            <UsedBy uses={header.used_by} />

            {deleting?.header_id === header.header_id ? (
              <ConfirmDelete
                what={`"${headerLabel(header)}"`}
                uses={header.used_by}
                effect="They keep going with no header until you pick another."
                error={deleteError}
                onConfirm={() => void confirmDelete()}
                onCancel={() => {
                  setDeleting(null)
                  focusLater(buttonId(header.header_id, 'delete'))
                }}
              />
            ) : (
              <div className="actions">
                <button
                  type="button"
                  id={buttonId(header.header_id, 'edit')}
                  aria-label={`Edit "${headerLabel(header)}"`}
                  onClick={() => startEditing({ headerId: header.header_id, fields: fieldsOf(header) })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  id={buttonId(header.header_id, 'delete')}
                  aria-label={`Delete "${headerLabel(header)}"`}
                  onClick={() => {
                    setDeleting(header)
                    setDeleteError(null)
                    setEditing(null)
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </article>
        ),
      )}
    </section>
  )
}
