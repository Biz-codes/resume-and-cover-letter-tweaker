// The job posting a resume or cover letter is for, read in the side panel (SidePanel) without
// leaving the document: its role and organization, its link (or contact), its description, and the
// contacts notes kept on it. Read once when the tab is first shown; it's changed on the posting's
// own page.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { isWebAddress, postingName, postingsApi, type PostingDetail } from '../../postings/postings'

export default function PostingDetails({ postingId }: { postingId: number }) {
  const [posting, setPosting] = useState<PostingDetail | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    try {
      setPosting(await postingsApi.get(postingId))
      setError(null)
    } catch (caught) {
      setError(toApiError(caught))
    }
  }, [postingId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div role="alert">
        <p>{error.message}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }
  if (!posting) return <p>Loading the job posting…</p>

  return (
    <>
      <h4>{postingName(posting)}</h4>
      <p>
        {/* A new tab, so the document stays open; screen readers are told it opens one. */}
        {isWebAddress(posting.url) ? (
          <a href={posting.url} target="_blank" rel="noreferrer">
            The posting <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        ) : (
          `Contact: ${posting.url}`
        )}
      </p>
      <h5>Job description</h5>
      <p className="description">{posting.description}</p>
      {posting.contacts?.trim() && (
        <>
          <h5>Contacts</h5>
          <p className="description">{posting.contacts}</p>
        </>
      )}
    </>
  )
}
