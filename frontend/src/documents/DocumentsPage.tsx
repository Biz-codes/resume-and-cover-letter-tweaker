// The resumes or cover letters page: base versions first, then the ones made for job postings,
// each linking to its own page (DocumentPage). A new base version starts fresh, with the
// default header (and for a letter, greeting and sign-off) and the default sections and their
// contents (docs/FRONTEND_CHECKS.md, "Defaults"), or as a copy of any existing one, base or
// tailored, whose original never changes. It opens on its own page.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toApiError, type ApiError } from '../shared/api/client'
import { docsApi, KINDS, type Doc, type DocKind } from '../shared/api/documents'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { sortByName } from '../shared/sortByName'
import AlertDialog from '../shared/components/Dialog/AlertDialog'

const DESCRIPTIONS: Record<DocKind, string> = {
  resume:
    'Base resumes are ongoing starting points you keep improving. Resumes made for a job posting are kept as their own versions, and locked once you apply.',
  cover_letter:
    'Base cover letters are ongoing starting points you keep improving. Letters made for a job posting are kept as their own versions, and locked once you apply.',
}

const NEW_DOC_ID = 'new-document'

// The notice another page sends with the move here (a delete, a new version).
export interface ListState {
  notice?: string
}

// The form for a new base version: its name, and what it starts from. It opens in place of its
// button, so focus moves to the name, and back to the button when it's cancelled.
function NewBaseForm({
  singular,
  docs,
  onCreate,
  onCancel,
}: {
  singular: string
  // Every existing one, to start a copy of.
  docs: Doc[]
  // `fromId` is the version to copy, or null to start fresh.
  onCreate: (name: string, fromId: number | null) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  useEffect(() => nameRef.current?.focus(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(name, from ? Number(from) : null)
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  const invalid = error?.field === 'name'
  const bases = docs.filter((doc) => !doc.job_posting)
  const tailored = docs.filter((doc) => doc.job_posting)
  const nameOf = (doc: Doc) => (doc.job_posting ? `${doc.name} (for ${doc.job_posting.organization})` : doc.name)

  return (
    <form className="card stacked-form" onSubmit={submit} aria-label={`New base ${singular}`}>
      <label>
        Name of the new base {singular} (required)
        <input
          ref={nameRef}
          value={name}
          aria-required="true"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Start from
        <select value={from} onChange={(event) => setFrom(event.target.value)}>
          <option value="">Fresh, with the usual defaults</option>
          {/* Base versions first, then the ones for postings, named with their organization, each A to Z. */}
          {[...sortByName(bases, nameOf), ...sortByName(tailored, nameOf)].map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.name}
              {doc.job_posting && ` (for ${doc.job_posting.organization})`}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? 'Creating…' : `Create base ${singular}`}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function DocLink({ kind, doc }: { kind: DocKind; doc: Doc }) {
  return (
    <li>
      <Link to={`${KINDS[kind].path}/${doc.id}`}>{doc.name}</Link>
      {doc.locked && <span className="tag">sent</span>}
      {doc.job_posting && (
        <span className="muted">
          {' '}
          for {doc.job_posting.organization}: {doc.job_posting.role_title}
        </span>
      )}
      {doc.based_on && <span className="muted"> (copied from {doc.based_on.name})</span>}
    </li>
  )
}

export default function DocumentsPage({ kind }: { kind: DocKind }) {
  const { singular, plural } = KINDS[kind]
  const api = docsApi(kind)
  const location = useLocation()
  const navigate = useNavigate()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle(plural)

  const load = useCallback(
    () =>
      docsApi(kind)
        .list()
        .then((list) => {
          setDocs(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [kind],
  )

  useEffect(() => {
    void load()
  }, [load])

  // A notice sent from another page opens once the page has rendered and App has moved focus to its
  // heading, so OK returns focus there.
  const sentNotice = (location.state as ListState | null)?.notice ?? null
  useEffect(() => {
    const timer = setTimeout(() => setNotice(sentNotice))
    return () => clearTimeout(timer)
  }, [sentNotice])

  async function create(name: string, fromId: number | null) {
    const doc = fromId === null ? await api.create(name) : await api.copy(fromId, name)
    const notice =
      fromId === null ? `Created "${doc.name}".` : `Copied to a new base ${singular}, "${doc.name}". The original is unchanged.`
    navigate(`${KINDS[kind].path}/${doc.id}`, { state: { notice } satisfies ListState })
  }

  const bases = docs?.filter((doc) => !doc.job_posting) ?? []
  const tailored = docs?.filter((doc) => doc.job_posting) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {plural}
      </h2>
      <p className="muted">{DESCRIPTIONS[kind]}</p>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!docs && !loadError && <p>Loading…</p>}

      {creating && docs ? (
        <NewBaseForm
          singular={singular}
          docs={docs}
          onCreate={create}
          onCancel={() => {
            setCreating(false)
            focusLater(NEW_DOC_ID)
          }}
        />
      ) : (
        docs && (
          <button type="button" id={NEW_DOC_ID} onClick={() => setCreating(true)}>
            New base {singular}
          </button>
        )
      )}

      {docs && (
        <>
          <h3>Base {plural.toLowerCase()}</h3>
          {bases.length === 0 ? (
            <p>No base {plural.toLowerCase()} yet.</p>
          ) : (
            <ul className="doc-list">
              {bases.map((doc) => (
                <DocLink key={doc.id} kind={kind} doc={doc} />
              ))}
            </ul>
          )}
          <h3>For job postings</h3>
          {tailored.length === 0 ? (
            <p>No {plural.toLowerCase()} for job postings yet.</p>
          ) : (
            <ul className="doc-list">
              {tailored.map((doc) => (
                <DocLink key={doc.id} kind={kind} doc={doc} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
