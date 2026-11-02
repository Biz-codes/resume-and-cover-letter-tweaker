// The job postings page: every posting, most recently updated first, each linking to its own
// page (PostingPage), and a form for a new one from its url and pasted description. Fetching a
// posting from its url comes in phase 5. A new posting opens on its own page, to pick its header.
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toApiError, type ApiError } from '../shared/api/client'
import { POSTING_FIELDS, postingName, postingsApi, type Posting, type PostingFields } from './postings'
import FieldsForm from '../shared/components/FieldsForm'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import type { ListState } from '../documents/DocumentsPage'

const NEW_POSTING_ID = 'new-posting'

const EMPTY: PostingFields = { url: '', organization: '', role_title: '', description: '' }

// How many resumes and cover letters a posting has, for its line in a list.
function versionCount(posting: Posting) {
  const count = (kind: string, one: string, many: string) => {
    const n = posting.versions.filter((use) => use.kind === kind).length
    return `${n} ${n === 1 ? one : many}`
  }
  return `${count('resume', 'resume', 'resumes')}, ${count('cover_letter', 'cover letter', 'cover letters')}`
}

export default function PostingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [postings, setPostings] = useState<Posting[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Job postings')

  const load = useCallback(
    () =>
      postingsApi
        .list()
        .then((list) => {
          setPostings(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  // A notice sent from another page (a delete) goes into the live region after it's rendered,
  // so screen readers announce it.
  const sentNotice = (location.state as ListState | null)?.notice ?? null
  useEffect(() => {
    const timer = setTimeout(() => setNotice(sentNotice))
    return () => clearTimeout(timer)
  }, [sentNotice])

  async function create(fields: PostingFields) {
    const posting = await postingsApi.create(fields)
    navigate(`/postings/${posting.job_posting_id}`, {
      state: { notice: `Saved the posting. Next, create a header.` } satisfies ListState,
    })
  }

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Job postings
      </h2>
      <p className="muted">
        Each application starts with its posting. Its resumes and cover letters use the posting&apos;s
        header, and are locked once you apply.
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
      {!postings && !loadError && <p>Loading…</p>}

      {creating ? (
        <FieldsForm
          label="New job posting"
          fields={POSTING_FIELDS}
          initial={EMPTY}
          submitLabel="Save posting"
          onSave={create}
          onCancel={() => {
            setCreating(false)
            focusLater(NEW_POSTING_ID)
          }}
        />
      ) : (
        postings && (
          <button type="button" id={NEW_POSTING_ID} onClick={() => setCreating(true)}>
            New job posting
          </button>
        )
      )}

      {postings &&
        (postings.length === 0 ? (
          <p>No job postings yet.</p>
        ) : (
          <ul className="doc-list">
            {postings.map((posting) => (
              <li key={posting.job_posting_id}>
                <Link to={`/postings/${posting.job_posting_id}`}>{postingName(posting)}</Link>
                {posting.locked && <span className="tag">applied</span>}
                <span className="muted"> ({versionCount(posting)})</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}
