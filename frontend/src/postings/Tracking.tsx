// What happened with an application: the applied, turned down, and hired dates and the contacts.
// They can change at any time. Recording the applied date locks the posting's resume and cover
// letter, and clearing it unlocks them, so clearing asks first. See "Sent versions are locked"
// in docs/FRONTEND_CHECKS.md.
import { useEffect, useId, useRef, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { showDate, TRACKING_FIELDS, type PostingDetail, type TrackingFields } from './postings'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import FieldsForm from '../shared/components/FieldsForm'

const EDIT_BUTTON_ID = 'tracking-edit'

const fieldsOf = ({ applied_on, rejected_on, hired_on, contacts }: PostingDetail): TrackingFields => ({
  applied_on,
  rejected_on,
  hired_on,
  contacts,
})

function ConfirmClear({
  error,
  onConfirm,
  onCancel,
}: {
  error: ApiError | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const questionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => cancelRef.current?.focus(), [])

  return (
    <div className="confirm" role="group" aria-labelledby={questionId}>
      <p id={questionId}>Clear the applied date?</p>
      <p>This posting's resume and cover letter stop being a record of what you sent and can be changed again.</p>
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        <button type="button" onClick={onConfirm}>
          Clear the date
        </button>
        <button type="button" ref={cancelRef} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function Tracking({
  posting,
  onSave,
}: {
  posting: PostingDetail
  onSave: (fields: TrackingFields) => Promise<void>
}) {
  const [draft, setDraft] = useState<TrackingFields | null>(null)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const focusLater = useFocusLater()

  function close() {
    setDraft(null)
    setClearing(false)
    focusLater(EDIT_BUTTON_ID)
  }

  async function save(fields: TrackingFields) {
    await onSave(fields)
    close()
  }

  async function submit(values: TrackingFields) {
    // A cleared date input sends an empty string.
    const fields = { ...values, applied_on: values.applied_on || null, rejected_on: values.rejected_on || null, hired_on: values.hired_on || null }
    if (posting.applied_on && !fields.applied_on) {
      setDraft(fields)
      setError(null)
      setClearing(true)
    } else {
      await save(fields)
    }
  }

  function confirmClear(fields: TrackingFields) {
    setError(null)
    save(fields).catch((caught: unknown) => setError(toApiError(caught)))
  }

  if (draft && clearing) {
    return (
      <ConfirmClear
        error={error}
        onConfirm={() => confirmClear(draft)}
        onCancel={() => {
          setDraft({ ...draft, applied_on: posting.applied_on })
          setClearing(false)
        }}
      />
    )
  }
  if (draft) {
    return (
      <FieldsForm
        label="Edit tracking"
        fields={TRACKING_FIELDS}
        initial={draft}
        note={posting.applied_on ? undefined : "An applied date locks this posting's resume and cover letter."}
        onSave={submit}
        onCancel={close}
      />
    )
  }

  const dates = [
    ['Applied on', posting.applied_on],
    ['Turned down on', posting.rejected_on],
    ['Hired on', posting.hired_on],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  return (
    <>
      {dates.length > 0 || posting.contacts ? (
        <dl className="details-list">
          {dates.flatMap(([label, value]) => [<dt key={label}>{label}</dt>, <dd key={`${label} value`}>{showDate(value)}</dd>])}
          {posting.contacts && (
            <>
              <dt>Contacts</dt>
              <dd className="description">{posting.contacts}</dd>
            </>
          )}
        </dl>
      ) : (
        <p>No dates or contacts yet.</p>
      )}
      <div className="actions">
        <button type="button" id={EDIT_BUTTON_ID} onClick={() => setDraft(fieldsOf(posting))}>
          Edit tracking
        </button>
      </div>
    </>
  )
}
