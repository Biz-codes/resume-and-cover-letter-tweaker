// One job posting, headed as the user's application to it: its link and job description (with
// Edit details and Delete inside it), its header (used by all its versions), and its resume and
// cover letter, each started fresh or from a copy (StartVersion) and named for the posting. A new
// posting picks its header first, from the suggestion, with that section open, since its versions
// use it; once picked, the section starts closed. Once the posting is applied to, its versions are
// a record of what was sent, so no new ones start here. Below them, its tracking: the dates,
// contacts, and interviews.
// See docs/APP_FLOW.md ("User flow") and "Headers" and "Starting a version for a posting" in
// docs/FRONTEND_CHECKS.md.
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toApiError, type ApiError } from '../api/client'
import { capitalize, docsApi, KINDS, type Doc, type DocKind } from '../api/documents'
import { headersApi, type Header, type HeaderFields as Fields } from '../api/headers'
import {
  isWebAddress,
  POSTING_FIELDS,
  postingName,
  postingsApi,
  type PostingDetail,
  type PostingFields,
  type TrackingFields,
} from '../api/postings'
import { KIND_LABELS } from '../api/usage'
import ConfirmDelete from '../components/ConfirmDelete'
import Disclosure from '../components/Disclosure'
import FieldsForm from '../components/FieldsForm'
import HeaderFields from '../components/HeaderFields'
import Interviews from '../components/Interviews'
import StartVersion from '../components/StartVersion'
import Tracking from '../components/Tracking'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'
import type { ListState } from './DocumentsPage'

// The buttons that open each form, where focus returns when it closes.
const BUTTON_IDS = { edit: 'posting-edit', delete: 'posting-delete' }

type Mode = keyof typeof BUTTON_IDS

const fieldsOf = ({ url, organization, role_title, description }: PostingDetail): PostingFields => ({
  url,
  organization,
  role_title,
  description,
})

export function PostingPage({ id }: { id: number }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [posting, setPosting] = useState<PostingDetail | null>(null)
  const [headers, setHeaders] = useState<Header[]>([])
  const [docs, setDocs] = useState<Record<DocKind, Doc[]>>({ resume: [], cover_letter: [] })
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  const title = posting ? `${postingName(posting)} Application` : 'Job posting'
  usePageTitle(title)

  const load = useCallback(
    () =>
      Promise.all([postingsApi.get(id), headersApi.list(), docsApi('resume').list(), docsApi('cover_letter').list()])
        .then(([loaded, headerList, resumes, letters]) => {
          setPosting(loaded)
          setHeaders(headerList)
          setDocs({ resume: resumes, cover_letter: letters })
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [id],
  )

  useEffect(() => {
    void load()
  }, [load])

  // A notice sent with the move here (a new posting) goes into the live region after it's
  // rendered, so screen readers announce it.
  const sentNotice = (location.state as ListState | null)?.notice ?? null
  useEffect(() => {
    const timer = setTimeout(() => setNotice(sentNotice))
    return () => clearTimeout(timer)
  }, [sentNotice])

  function open(next: Mode) {
    setMode(next)
    setNotice(null)
    setDeleteError(null)
  }

  function close(returnTo: Mode) {
    setMode(null)
    focusLater(BUTTON_IDS[returnTo])
  }

  async function save(fields: PostingFields) {
    setPosting(await postingsApi.update(id, fields))
    setNotice('Saved the posting.')
    close('edit')
  }

  async function saveHeader(fields: Fields) {
    const first = !posting?.header_id
    const updated = await postingsApi.setHeader(id, fields)
    // A new combination of values is a new saved header, so the list is read again first. Both
    // change together, so the header is never looked for in a list that doesn't have it yet.
    const headerList = await headersApi.list()
    setHeaders(headerList)
    setPosting(updated)
    setNotice("Saved the header. This posting's resumes and cover letters use it.")
    // "Use this header" is gone once the header is picked, so focus moves on to the next step.
    if (first) focusLater('start-resume')
  }

  async function saveTracking(fields: TrackingFields) {
    setPosting(await postingsApi.setTracking(id, fields))
    setNotice('Saved the tracking details.')
  }

  async function start(kind: DocKind, current: PostingDetail, fromId: number | null) {
    const api = docsApi(kind)
    const name = postingName(current)
    const forPosting = { job_posting_id: id }
    const doc = fromId === null ? await api.create(name, forPosting) : await api.copy(fromId, name, forPosting)
    navigate(`${KINDS[kind].path}/${doc.id}`, {
      state: { notice: `Started "${doc.name}" for this posting.` } satisfies ListState,
    })
  }

  async function confirmDelete(current: PostingDetail) {
    setDeleteError(null)
    try {
      await postingsApi.delete(id)
      navigate('/postings', { state: { notice: `Deleted "${postingName(current)}".` } satisfies ListState })
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  const header = headers.find((item) => item.header_id === posting?.header_id)
  const interviews = posting?.lone_interviews ?? 0

  return (
    <section>
      <p>
        <Link to="/postings">All job postings</Link>
      </p>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {title}
      </h2>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          {loadError.code !== 'NOT_FOUND' && (
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </div>
      )}
      {!posting && !loadError && <p>Loading…</p>}

      {posting && (
        <>
          <p>
            {/* A new tab, so the posting page stays open; screen readers are told it opens one. */}
            {isWebAddress(posting.url) ? (
              <a href={posting.url} target="_blank" rel="noreferrer">
                The posting <span className="visually-hidden">(opens in a new tab)</span>
              </a>
            ) : (
              `Contact: ${posting.url}`
            )}
            {posting.locked && <span className="tag">applied</span>}
          </p>
          <Disclosure title="Job description">
            <p className="description">{posting.description}</p>
            {mode === 'edit' && (
              <FieldsForm
                label={`Edit "${postingName(posting)}"`}
                fields={POSTING_FIELDS}
                initial={fieldsOf(posting)}
                onSave={save}
                onCancel={() => close('edit')}
              />
            )}
            {mode === 'delete' && (
              <ConfirmDelete
                what={`"${postingName(posting)}"`}
                // Named by kind, since both are named for the posting.
                uses={posting.versions.map((use) => ({ ...use, name: KIND_LABELS[use.kind] }))}
                usesLabel="Its resumes and cover letters"
                effect="They're deleted too."
                locked={posting.locked}
                lockedNote="You applied to this posting, so deleting it removes the record of what you sent."
                error={deleteError}
                onConfirm={() => void confirmDelete(posting)}
                onCancel={() => close('delete')}
              >
                {interviews > 0 && (
                  <p>
                    {interviews === 1 ? 'Its interview' : `Its ${interviews} interviews`} with no other posting will
                    be deleted too.
                  </p>
                )}
              </ConfirmDelete>
            )}
            {mode === null && (
              <div className="actions">
                <button type="button" id={BUTTON_IDS.edit} onClick={() => open('edit')}>
                  Edit details
                </button>
                <button type="button" id={BUTTON_IDS.delete} onClick={() => open('delete')}>
                  Delete
                </button>
              </div>
            )}
          </Disclosure>
          {posting.locked && (
            <p className="note">
              You applied to this posting, so its resumes and cover letters are a record of what you sent.
            </p>
          )}

          <Disclosure
            title="Header"
            heading={3}
            // Open until the first header is picked, then a new one, closed, starting from the
            // saved values. Later changes keep it open, like a resume's header fields.
            key={posting.header_id ? 'picked' : 'suggested'}
            initiallyOpen={!posting.header_id}
          >
            <HeaderFields
              header={header}
              headers={headers}
              suggested={posting.suggested_header ?? undefined}
              readOnly={posting.locked}
              onSave={saveHeader}
            />
          </Disclosure>
          {!posting.header_id && !posting.locked && (
            <p className="muted">Resumes and cover letters can start once the posting has a header.</p>
          )}

          {(['resume', 'cover_letter'] as const).map((kind) => {
            // A posting has one of each, edited in place until it's applied to.
            const version = posting.versions.find((use) => use.kind === kind)
            const { path, singular } = KINDS[kind]
            const name = capitalize(singular)
            return (
              <div key={kind}>
                {version ? (
                  <p>
                    <Link to={`${path}/${version.id}`} aria-label={`${name} for ${postingName(posting)}`}>
                      {name}
                    </Link>
                    {version.locked && <span className="tag">sent</span>}
                  </p>
                ) : (
                  <p>No {singular} for this posting yet.</p>
                )}
                {!version && !posting.locked && posting.header_id && (
                  <StartVersion
                    kind={kind}
                    docs={docs[kind]}
                    onStart={(fromId) => start(kind, posting, fromId)}
                  />
                )}
              </div>
            )
          })}

          <Disclosure title="Application tracking" heading={3}>
            <Tracking posting={posting} onSave={saveTracking} />
            <Interviews
              posting={posting}
              onChanged={(updated, message) => {
                setPosting(updated)
                setNotice(message)
              }}
            />
          </Disclosure>
        </>
      )}
    </section>
  )
}

export default function PostingRoute() {
  const { id } = useParams()
  return <PostingPage key={id} id={Number(id)} />
}
