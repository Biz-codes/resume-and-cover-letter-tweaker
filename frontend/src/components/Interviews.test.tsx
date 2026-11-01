import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PostingDetail } from '../api/postings'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi } from '../test/stubApi'
import Interviews from './Interviews'

const COACH = { job_posting_id: 10, organization: 'Lincoln High', role_title: 'Debate Coach' }
const FAR = { job_posting_id: 20, organization: 'Lincoln Schools', role_title: 'Librarian' }
const POSTING: PostingDetail = {
  job_posting_id: 9,
  url: 'https://example.com/jobs/9',
  organization: 'Lincoln High',
  role_title: 'English Teacher',
  description: 'Teach.',
  header_id: 2,
  applied_on: null,
  locked: false,
  versions: [],
  updated_at: null,
  suggested_header: null,
  lone_interviews: 0,
  rejected_on: null,
  hired_on: null,
  contacts: null,
  interviews: [],
  same_organization: [COACH],
}
const FIRST = { interview_id: 1, interview_on: '2026-10-05', notes: 'First round', also_for: [COACH] }
const WITH_ONE = { ...POSTING, interviews: [FIRST] }

function renderInterviews(posting = POSTING) {
  const onChanged = vi.fn()
  render(
    <>
      <h2 id="page-heading" tabIndex={-1}>
        Page
      </h2>
      <h3>Application tracking</h3>
      <Interviews posting={posting} onChanged={onChanged} />
    </>,
  )
  return onChanged
}

describe('Interviews', () => {
  it('adds one that also covers another posting', async () => {
    const fetchMock = stubApi({ 'POST /api/job-postings/9/interviews': [{ status: 201, body: WITH_ONE }] })
    const onChanged = renderInterviews()
    expect(screen.getByText('No interviews yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }))
    const date = screen.getByLabelText('Date (required)')
    await vi.waitFor(() => expect(date).toHaveFocus())
    await expectNoA11yViolations()
    fireEvent.change(date, { target: { value: '2026-10-05' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Also covered' })).getByRole('checkbox', { name: 'Debate Coach at Lincoln High' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(WITH_ONE, 'Added the interview.'))
    expect(sentBody(fetchMock, 'POST /api/job-postings/9/interviews')).toEqual({ interview_on: '2026-10-05', notes: '', also_posting_ids: [10] })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Add interview' })).toHaveFocus())
  })

  it('offers no postings when the organization has no others', () => {
    renderInterviews({ ...POSTING, same_organization: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }))
    expect(screen.queryByRole('group', { name: 'Also covered' })).not.toBeInTheDocument()
  })

  it('shows a refused date in the form, and cancels back to its button', async () => {
    stubApi({
      'POST /api/job-postings/9/interviews': [
        { status: 422, body: errorBody('VALIDATION_FAILED', 'Enter the date.', 'interview_on') },
      ],
    })
    renderInterviews()
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the date.')
    expect(screen.getByLabelText('Date (required)')).toHaveAttribute('aria-invalid', 'true')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Add interview' })).toHaveFocus())
  })

  it('edits one, keeping a link to a posting of another organization', async () => {
    const linked = { ...FIRST, also_for: [COACH, FAR] }
    const fetchMock = stubApi({ 'PUT /api/job-postings/9/interviews/1': [{ status: 200, body: WITH_ONE }] })
    const onChanged = renderInterviews({ ...POSTING, interviews: [linked] })
    expect(screen.getByText('First round')).toBeInTheDocument()
    expect(screen.getByText('Also covered: Debate Coach at Lincoln High; Librarian at Lincoln Schools')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit interview on October 5, 2026' }))
    await expectNoA11yViolations()
    expect(screen.getByLabelText('Date (required)')).toHaveValue('2026-10-05')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Debate Coach at Lincoln High' }))
    expect(screen.getByRole('checkbox', { name: 'Librarian at Lincoln Schools' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(WITH_ONE, 'Saved the interview.'))
    expect(sentBody(fetchMock, 'PUT /api/job-postings/9/interviews/1')).toEqual({ interview_on: '2026-10-05', notes: 'First round', also_posting_ids: [20] })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit interview on October 5, 2026' })).toHaveFocus())
  })

  it('cancels an edit back to its button', async () => {
    renderInterviews(WITH_ONE)
    fireEvent.click(screen.getByRole('button', { name: 'Edit interview on October 5, 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit interview on October 5, 2026' })).toHaveFocus())
  })

  it('warns which other postings lose it, then deletes it', async () => {
    stubApi({
      'DELETE /api/job-postings/9/interviews/1': [{ status: 204 }],
      'GET /api/job-postings/9': [{ status: 200, body: POSTING }],
    })
    const onChanged = renderInterviews(WITH_ONE)
    fireEvent.click(screen.getByRole('button', { name: 'Delete interview on October 5, 2026' }))
    const confirm = screen.getByRole('group', { name: 'Delete the interview on October 5, 2026?' })
    expect(confirm).toHaveTextContent("It's removed from Debate Coach at Lincoln High too.")
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(POSTING, 'Deleted the interview.'))
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Page' })).toHaveFocus())
  })

  it('shows a failed delete, and cancels back to its button', async () => {
    stubApi({
      'DELETE /api/job-postings/9/interviews/1': [{ status: 404, body: errorBody('NOT_FOUND', 'That item no longer exists.') }],
    })
    renderInterviews({ ...POSTING, interviews: [{ ...FIRST, notes: null, also_for: [] }] })
    fireEvent.click(screen.getByRole('button', { name: 'Delete interview on October 5, 2026' }))
    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That item no longer exists.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete interview on October 5, 2026' })).toHaveFocus())
  })
})
