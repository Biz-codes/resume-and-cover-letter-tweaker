// The resumes or cover letters page: base versions first, then the ones made for job postings,
// each linking to its own page (DocumentPage). A new base version starts with the default
// header (and for a letter, greeting and sign-off) and the default sections and their contents
// (docs/FRONTEND_CHECKS.md, "Defaults"), and opens on its own page.
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toApiError, type ApiError } from '../api/client'
import { docsApi, KINDS, type Doc, type DocKind } from '../api/documents'
import NameForm from '../components/NameForm'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

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

  // A notice sent from another page goes into the live region after it's rendered, so screen
  // readers announce it.
  const sentNotice = (location.state as ListState | null)?.notice ?? null
  useEffect(() => {
    const timer = setTimeout(() => setNotice(sentNotice))
    return () => clearTimeout(timer)
  }, [sentNotice])

  async function create(name: string) {
    const doc = await api.create(name)
    navigate(`${KINDS[kind].path}/${doc.id}`, { state: { notice: `Created "${doc.name}".` } })
  }

  const bases = docs?.filter((doc) => !doc.job_posting) ?? []
  const tailored = docs?.filter((doc) => doc.job_posting) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {plural}
      </h2>
      <p className="muted">{DESCRIPTIONS[kind]}</p>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!docs && !loadError && <p>Loading…</p>}

      {creating ? (
        <NameForm
          label={`Name of the new base ${singular}`}
          field="name"
          submitLabel={`Create base ${singular}`}
          onSave={create}
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
