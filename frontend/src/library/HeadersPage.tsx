// Library page for headers: list and add them, and open each one's dialog (HeaderItem) to edit it,
// add a version of it, or delete it, with the version rules from "Headers" and "Sent versions are
// locked" in docs/FRONTEND_CHECKS.md.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { headersApi, type Header, type HeaderFields } from '../shared/api/headers'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import HeaderForm from './items/HeaderForm'
import { EMPTY_HEADER, headerLabels } from './items/itemFields'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import LibraryCard from './LibraryCard'

// The New header button, where focus returns when its form closes.
const NEW_HEADER_ID = 'new-header'

export default function HeadersPage() {
  const [headers, setHeaders] = useState<Header[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
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

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })

  // A header with exactly these values is reused, so saving may add nothing.
  async function create(fields: HeaderFields) {
    const known = new Set(headers?.map((header) => header.header_id))
    const header = await headersApi.create(fields)
    setAdding(false)
    await load()
    setNotice(known.has(header.header_id) ? 'An identical header already exists, so no new one was added.' : 'Saved.')
    focusLater(editId('header', header.header_id))
  }

  // Names that tell versions apart (labels.ts), for the cards and their buttons.
  const labelOf = headerLabels(headers ?? [])

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
          initial={EMPTY_HEADER}
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
          editId={editId('header', header.header_id)}
          editLabel={`Edit "${labelOf(header)}"`}
          onEdit={() => dialogs.open({ kind: 'header', id: header.header_id, title: labelOf(header) })}
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
      {dialogs.dialog}
    </section>
  )
}
