// Library page for headers: list, add, edit, and delete, with the version rules from
// "Headers" and "Sent versions are locked" in docs/FRONTEND_CHECKS.md.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { headersApi, type Header, type HeaderFields, type HeaderUse } from '../api/headers'

const FIELDS: { name: keyof HeaderFields; label: string; type?: string }[] = [
  { name: 'full_name', label: 'Full name (required)' },
  { name: 'headline', label: 'Headline' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'location', label: 'Location' },
  { name: 'linkedin_url', label: 'LinkedIn URL' },
  { name: 'github_url', label: 'GitHub URL' },
  { name: 'portfolio_url', label: 'Portfolio URL' },
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

const KIND_LABELS: Record<HeaderUse['kind'], string> = {
  job_posting: 'Job posting',
  resume: 'Resume',
  cover_letter: 'Cover letter',
}

type Editing = { headerId: number | null; fields: HeaderFields }

function errorOf(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', String(error), null, 0)
}

function fieldsOf(header: Header): HeaderFields {
  const { header_id: _id, used_by: _usedBy, ...fields } = header
  return fields
}

function UsedBy({ uses }: { uses: HeaderUse[] }) {
  if (uses.length === 0) return <p className="muted">Not used yet.</p>
  return (
    <ul className="uses">
      {uses.map((use) => (
        <li key={`${use.kind}-${use.id}`}>
          {KIND_LABELS[use.kind]}: {use.name}
          {use.locked && <span className="tag">sent</span>}
        </li>
      ))}
    </ul>
  )
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
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave()
  }

  return (
    <form className="card" onSubmit={submit} aria-label={editing.headerId ? 'Edit header' : 'New header'}>
      {locked && (
        <p className="note">
          A sent version uses this header, so your changes will be saved as a new header.
          Everything that uses this one keeps it; pick the new header where you want it.
        </p>
      )}
      {FIELDS.map(({ name, label, type }) => (
        <label key={name}>
          {label}
          <input
            name={name}
            type={type ?? 'text'}
            value={editing.fields[name] ?? ''}
            aria-invalid={error?.field === name}
            onChange={(event) => onChange({ ...editing.fields, [name]: event.target.value })}
          />
        </label>
      ))}
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        <button type="submit" disabled={saving}>
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

  const load = useCallback(
    () =>
      headersApi
        .list()
        .then((list) => {
          setHeaders(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(errorOf(error))),
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
    } catch (error) {
      setFormError(errorOf(error))
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
      setNotice('Header deleted.')
      await load()
    } catch (error) {
      setDeleteError(errorOf(error))
    }
  }

  const editedHeader = headers?.find((header) => header.header_id === editing?.headerId)

  return (
    <section>
      <h2>Headers</h2>
      <p className="muted">
        The name, headline, and contact details at the top of a resume or cover letter.
      </p>
      {notice && <p role="status">{notice}</p>}

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
          onCancel={() => setEditing(null)}
        />
      ) : (
        headers && (
          <button type="button" onClick={() => startEditing({ headerId: null, fields: EMPTY })}>
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
            locked={editedHeader?.used_by.some((use) => use.locked) ?? false}
            error={formError}
            saving={saving}
            onChange={(fields) => setEditing({ ...editing, fields })}
            onSave={() => void save()}
            onCancel={() => setEditing(null)}
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
            <h4>Used by</h4>
            <UsedBy uses={header.used_by} />

            {deleting?.header_id === header.header_id ? (
              <div className="confirm" role="group" aria-label="Confirm delete">
                <p>Delete this header?</p>
                {header.used_by.length > 0 && (
                  <p>
                    These will keep going with no header until you pick another:{' '}
                    {header.used_by.map((use) => use.name).join('; ')}.
                  </p>
                )}
                {header.used_by.some((use) => use.locked) && (
                  <p>
                    A sent version uses it, so deleting it changes the record of what you sent.
                  </p>
                )}
                {deleteError && <p role="alert">{deleteError.message}</p>}
                <div className="actions">
                  <button type="button" onClick={() => void confirmDelete()}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setDeleting(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button
                  type="button"
                  onClick={() => startEditing({ headerId: header.header_id, fields: fieldsOf(header) })}
                >
                  Edit
                </button>
                <button
                  type="button"
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
