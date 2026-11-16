// The job postings page: every posting, most recently updated first, each linking to its own
// page (PostingPage), and a form for a new one (NewPosting), read from its page or pasted text. A
// new posting opens on its own page, to pick its header. Hidden ones are listed last, under
// "Hidden (n)", with Unhide (docs/FRONTEND_CHECKS.md, "Hiding").
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toApiError, type ApiError } from '../shared/api/client'
import { postingName, postingsApi, type Posting, type PostingFields } from './postings'
import NewPosting from './NewPosting'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import type { ListState } from '../documents/DocumentsPage'
import AlertDialog from '../shared/components/Dialog/AlertDialog'
import HiddenItems, { UnhideButton } from '../library/HiddenItems'

const NEW_POSTING_ID = 'new-posting'
// Each posting's link, where focus goes once it's unhidden.
const linkId = (id: number) => `posting-${id}-link`

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

  // A notice sent from another page (a delete) opens once the page has rendered and App has moved
  // focus to its heading, so OK returns focus there.
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

  async function unhide(posting: Posting) {
    await postingsApi.setHidden(posting.job_posting_id, false)
    await load()
    setNotice(`Unhid "${postingName(posting)}".`)
    focusLater(linkId(posting.job_posting_id))
  }

  const shown = postings?.filter((posting) => !posting.hidden) ?? []
  const hiddenOnes = postings?.filter((posting) => posting.hidden) ?? []
  const row = (posting: Posting, hidden = false) => (
    <li key={posting.job_posting_id}>
      <Link id={linkId(posting.job_posting_id)} to={`/postings/${posting.job_posting_id}`}>
        {postingName(posting)}
      </Link>
      {posting.locked && <span className="tag">applied</span>}
      <span className="muted"> ({versionCount(posting)})</span>
      {hidden && (
        <>
          {' '}
          <UnhideButton name={postingName(posting)} onUnhide={() => unhide(posting)} />
        </>
      )}
    </li>
  )

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Job postings
      </h2>
      <p className="muted">
        Each application starts with its posting. Its resumes and cover letters use the posting&apos;s
        header, and are locked once you apply.
      </p>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
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
        <NewPosting
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

      {postings && (
        <>
          {shown.length === 0 ? (
            <p>{hiddenOnes.length ? 'No job postings that aren\'t hidden.' : 'No job postings yet.'}</p>
          ) : (
            <ul className="doc-list">{shown.map((posting) => row(posting))}</ul>
          )}
          <HiddenItems count={hiddenOnes.length}>
            <ul className="doc-list">{hiddenOnes.map((posting) => row(posting, true))}</ul>
          </HiddenItems>
        </>
      )}
    </section>
  )
}
