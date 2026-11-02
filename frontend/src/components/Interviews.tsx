// A posting's interviews, in date order. One interview can cover several of the organization's
// postings, so the form offers them as checkboxes, and a delete says which others lose it. They
// can change at any time, including after the posting is applied to. See "Tracking an
// application" in docs/FRONTEND_CHECKS.md.
import { useState } from 'react'
import { toApiError, type ApiError } from '../api/client'
import {
  INTERVIEW_FIELDS,
  postingName,
  postingsApi,
  showDate,
  type Interview,
  type InterviewFields,
  type PostingDetail,
  type PostingRef,
} from '../api/postings'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import Checklist from './Checklist'
import ConfirmDelete from './ConfirmDelete'
import FieldsForm from './FieldsForm'

const ADD_BUTTON_ID = 'interview-add'
const NO_VALUES: InterviewFields = { interview_on: '', notes: '' }

const editButtonId = (id: number) => `interview-edit-${id}`
const nameOf = (interview: Interview) => `interview on ${showDate(interview.interview_on)}`

type Mode = { action: 'add' } | { action: 'edit' | 'delete'; id: number }

function InterviewForm({
  label,
  initial,
  initialAlso,
  options,
  onSave,
  onCancel,
}: {
  label: string
  initial: InterviewFields
  initialAlso: number[]
  options: PostingRef[]
  onSave: (fields: InterviewFields, also: number[]) => Promise<void>
  onCancel: () => void
}) {
  const [also, setAlso] = useState(initialAlso)
  return (
    <FieldsForm
      label={label}
      fields={INTERVIEW_FIELDS}
      initial={initial}
      onSave={(fields) => onSave(fields, also)}
      onCancel={onCancel}
    >
      {options.length > 0 && (
        <Checklist
          legend="Also covered"
          options={options.map((option) => ({ id: option.job_posting_id, name: postingName(option) }))}
          selected={also}
          onChange={setAlso}
        />
      )}
    </FieldsForm>
  )
}

export default function Interviews({
  posting,
  onChanged,
}: {
  posting: PostingDetail
  onChanged: (posting: PostingDetail, notice: string) => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const focusLater = useFocusLater()
  const id = posting.job_posting_id

  function open(next: Mode) {
    setMode(next)
    setDeleteError(null)
  }

  function close(returnTo: string) {
    setMode(null)
    focusLater(returnTo)
  }

  // The organization's postings, and any other this one is already linked to.
  function optionsFor(interview?: Interview) {
    const known = posting.same_organization.map((item) => item.job_posting_id)
    return [...posting.same_organization, ...(interview?.also_for ?? []).filter((item) => !known.includes(item.job_posting_id))]
  }

  async function add(fields: InterviewFields, also: number[]) {
    onChanged(await postingsApi.addInterview(id, fields, also), 'Added the interview.')
    close(ADD_BUTTON_ID)
  }

  async function update(interview: Interview, fields: InterviewFields, also: number[]) {
    onChanged(await postingsApi.updateInterview(id, interview.interview_id, fields, also), 'Saved the interview.')
    close(editButtonId(interview.interview_id))
  }

  async function remove(interview: Interview) {
    setDeleteError(null)
    try {
      await postingsApi.deleteInterview(id, interview.interview_id)
      onChanged(await postingsApi.get(id), 'Deleted the interview.')
      close(PAGE_HEADING_ID)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  return (
    <>
      <h4>Interviews</h4>
      {posting.interviews.length === 0 ? (
        <p>No interviews yet.</p>
      ) : (
        <ul className="doc-list">
          {posting.interviews.map((interview) => {
            const editing = mode?.action === 'edit' && mode.id === interview.interview_id
            const deleting = mode?.action === 'delete' && mode.id === interview.interview_id
            const name = nameOf(interview)
            return (
              <li key={interview.interview_id}>
                <p>{showDate(interview.interview_on)}</p>
                {interview.notes && <p className="description">{interview.notes}</p>}
                {interview.also_for.length > 0 && (
                  <p className="muted">Also covered: {interview.also_for.map(postingName).join('; ')}</p>
                )}
                {editing && (
                  <InterviewForm
                    label={`Edit ${name}`}
                    initial={{ interview_on: interview.interview_on, notes: interview.notes }}
                    initialAlso={interview.also_for.map((item) => item.job_posting_id)}
                    options={optionsFor(interview)}
                    onSave={(fields, also) => update(interview, fields, also)}
                    onCancel={() => close(editButtonId(interview.interview_id))}
                  />
                )}
                {deleting && (
                  <ConfirmDelete
                    what={`the ${name}`}
                    uses={[]}
                    effect=""
                    error={deleteError}
                    onConfirm={() => void remove(interview)}
                    onCancel={() => close(`interview-delete-${interview.interview_id}`)}
                  >
                    {interview.also_for.length > 0 && (
                      <p>It's removed from {interview.also_for.map(postingName).join('; ')} too.</p>
                    )}
                  </ConfirmDelete>
                )}
                {!editing && !deleting && (
                  <div className="actions">
                    <button
                      type="button"
                      id={editButtonId(interview.interview_id)}
                      aria-label={`Edit ${name}`}
                      onClick={() => open({ action: 'edit', id: interview.interview_id })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      id={`interview-delete-${interview.interview_id}`}
                      aria-label={`Delete ${name}`}
                      onClick={() => open({ action: 'delete', id: interview.interview_id })}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {mode?.action === 'add' ? (
        <InterviewForm
          label="Add an interview"
          initial={NO_VALUES}
          initialAlso={[]}
          options={optionsFor()}
          onSave={add}
          onCancel={() => close(ADD_BUTTON_ID)}
        />
      ) : (
        <button type="button" id={ADD_BUTTON_ID} onClick={() => open({ action: 'add' })}>
          Add interview
        </button>
      )}
    </>
  )
}
