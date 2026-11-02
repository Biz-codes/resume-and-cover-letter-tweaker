import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import PostingRoute from './PostingPage'

const blank = { location: null, linkedin_url: null, github_url: null, portfolio_url: null }
const SAM = { header_id: 1, full_name: 'Sam Rivera', headline: 'Engineer', email: 'sam@example.com', phone: null, ...blank, used_by: [] }
const TEACHER = { ...SAM, header_id: 2, headline: 'English Teacher' }
const POSTING = {
  job_posting_id: 9,
  url: 'https://example.com/jobs/9',
  organization: 'Lincoln High',
  role_title: 'English Teacher',
  description: 'Teach ninth grade English.\nCoach debate.',
  header_id: 2,
  applied_on: null,
  locked: false,
  versions: [
    { kind: 'resume', id: 11, name: 'English Teacher (Lincoln High)', locked: false },
    { kind: 'cover_letter', id: 12, name: 'Lincoln letter', locked: false },
  ],
  updated_at: null,
  suggested_header: null,
  lone_interviews: 0,
  rejected_on: null,
  hired_on: null,
  contacts: null,
  interviews: [],
  same_organization: [],
}
// Nothing started for it yet.
const EMPTY = { ...POSTING, versions: [] }
const NEW = {
  ...POSTING,
  header_id: null,
  versions: [],
  suggested_header: { full_name: 'Sam Rivera', headline: 'English Teacher', email: 'sam@example.com', phone: null, ...blank },
}
const doc = (id: number, name: string) => ({
  id,
  resume_id: id,
  letter_id: id,
  name,
  header_id: 1,
  tone_set_id: null,
  job_posting: null,
  based_on: null,
  locked: false,
  copies: [],
  updated_at: null,
})

function stub(posting: unknown = POSTING, extra: Record<string, Reply[]> = {}, headers: unknown[] = [TEACHER, SAM]) {
  return stubApi({
    'GET /api/job-postings/9': [{ status: 200, body: posting }],
    'GET /api/headers': [
      { status: 200, body: headers },
      // Read again after a header is saved; slower, as in the browser.
      { status: 200, body: [TEACHER, SAM], delayMs: 20 },
    ],
    'GET /api/resumes': [{ status: 200, body: [doc(1, 'Tech base')] }],
    'GET /api/cover-letters': [{ status: 200, body: [doc(3, 'General letter')] }],
    ...extra,
  })
}

function renderPage(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/postings/9', state }]}>
      <Routes>
        <Route path="/postings" element={<h2>All postings</h2>} />
        <Route path="/postings/:id" element={<PostingRoute />} />
        <Route path="/resumes/:id" element={<h2>Opened resume</h2>} />
        <Route path="/cover-letters/:id" element={<h2>Opened cover letter</h2>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PostingPage', () => {
  it('starts a new posting by picking its header from the suggestion', async () => {
    const fetchMock = stub(NEW, { 'PUT /api/job-postings/9/header': [{ status: 200, body: EMPTY }] }, [SAM])
    renderPage({ notice: 'Saved the posting. Next, create a header.' })
    expect(await screen.findByRole('heading', { level: 2, name: 'English Teacher at Lincoln High Application' })).toBeInTheDocument()
    await vi.waitFor(() => expect(document.title).toBe('English Teacher at Lincoln High Application – Resume Tweaker'))
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Next, create a header.'))
    // The suggestion: the latest header, with the role title typed in as a new headline.
    expect(screen.getByLabelText('Name (required)')).toHaveValue('Sam Rivera')
    expect(screen.getByLabelText('New headline')).toHaveValue('English Teacher')
    expect(screen.getByRole('heading', { level: 3, name: 'Header' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Header' })).toBeInTheDocument()
    // Nothing starts until the posting has a header.
    expect(screen.queryByRole('button', { name: /^Start a/ })).not.toBeInTheDocument()
    expect(screen.getByText('Resumes and cover letters can start once the posting has a header.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Use this header' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Saved the header. This posting's resumes and cover letters use it."),
    )
    expect(sentBody(fetchMock, 'PUT /api/job-postings/9/header')).toEqual({
      full_name: 'Sam Rivera',
      headline: 'English Teacher',
      email: 'sam@example.com',
      phone: null,
      ...blank,
    })
    // Picked: versions can start, which is where focus goes, and the header closes.
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start a resume' })).toHaveFocus())
    const toggle = screen.getByRole('button', { name: 'Header' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expectNoA11yViolations()
    // Opened again, it shows the values just saved.
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Use this header' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name (required)')).toHaveValue('Sam Rivera')
    expect(screen.getByLabelText('Headline')).toHaveValue('English Teacher')
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com')
  })

  it('links to its resume and cover letter, with nothing more to start', async () => {
    stub()
    renderPage()
    expect(await screen.findByRole('link', { name: 'Resume for English Teacher at Lincoln High' })).toHaveAttribute(
      'href',
      '/resumes/11',
    )
    expect(screen.getByRole('link', { name: 'Cover letter for English Teacher at Lincoln High' })).toHaveAttribute(
      'href',
      '/cover-letters/12',
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Resume and cover letter' })).toHaveClass('visually-hidden')
    expect(screen.getByRole('link', { name: /^Resume for/ })).toHaveTextContent(/^Resume$/)
    expect(screen.getByRole('link', { name: /^Cover letter for/ })).toHaveTextContent(/^Cover letter$/)
    // One of each per posting, worked on in place.
    expect(screen.queryByRole('button', { name: /^Start a/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('starts a fresh resume for it', async () => {
    const created = { ...doc(20, 'English Teacher (Lincoln High)'), sections: [], output: { parts: [], text: '' } }
    const fetchMock = stub(EMPTY, { 'POST /api/resumes': [{ status: 201, body: created }] })
    renderPage()
    expect(await screen.findByText('No resume for this posting yet.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'The posting (opens in a new tab)' })
    expect(link).toHaveAttribute('href', 'https://example.com/jobs/9')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(await screen.findByRole('heading', { name: 'Opened resume' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'POST /api/resumes')).toEqual({
      name: 'English Teacher at Lincoln High',
      job_posting_id: 9,
    })
  })

  it('names a version for the whole posting, however long', async () => {
    const opened = { ...doc(20, 'Opened'), sections: [], output: { parts: [], text: '' } }
    const longest = { ...EMPTY, role_title: 'R'.repeat(100), organization: 'O'.repeat(100) }
    const fetchMock = stub(longest, { 'POST /api/resumes': [{ status: 201, body: opened }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Start a resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/resumes')).toEqual({
        name: `${'R'.repeat(100)} at ${'O'.repeat(100)}`,
        job_posting_id: 9,
      }),
    )
  })

  it('starts a cover letter from a copy', async () => {
    const copied = { ...doc(21, 'Lincoln letter 2'), sections: [], output: { parts: [], text: '' } }
    const fetchMock = stub(EMPTY, { 'POST /api/cover-letters/3/copies': [{ status: 201, body: copied }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Start a cover letter' }))
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start cover letter' }))
    expect(await screen.findByRole('heading', { name: 'Opened cover letter' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'POST /api/cover-letters/3/copies')).toEqual({
      name: 'English Teacher at Lincoln High',
      job_posting_id: 9,
    })
  })

  it('edits its details, and shows its description', async () => {
    const edited = { ...POSTING, role_title: 'Lead English Teacher' }
    const fetchMock = stub(POSTING, { 'PUT /api/job-postings/9': [{ status: 200, body: edited }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Job description' }))
    expect(screen.getByText(/Coach debate\./)).toHaveClass('description')
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    const role = screen.getByLabelText('Role title (required)')
    expect(screen.getByLabelText('Link to the posting or primary contact (required)')).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(role, { target: { value: 'Lead English Teacher' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Lead English Teacher at Lincoln High Application' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'PUT /api/job-postings/9')).toMatchObject({ role_title: 'Lead English Teacher' })
    expect(screen.getByRole('status')).toHaveTextContent('Saved the posting.')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit details' })).toHaveFocus())
  })

  it('deletes it after listing what goes with it', async () => {
    stub({ ...POSTING, lone_interviews: 2 }, { 'DELETE /api/job-postings/9': [{ status: 204, body: null }] })
    renderPage()
    // Edit details and Delete are inside the job description.
    const description = await screen.findByRole('button', { name: 'Job description' })
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    fireEvent.click(description)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('group', { name: 'Delete "English Teacher at Lincoln High"?' })
    expect(confirm).toHaveTextContent(
      'Its resumes and cover letters: Resume; Cover letter. They\'re deleted too.',
    )
    expect(confirm).toHaveTextContent('Its 2 interviews with no other posting will be deleted too.')
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'All postings' })).toBeInTheDocument()
  })

  it('shows a contact, not a link, for a job with no posting online', async () => {
    stub({ ...POSTING, url: 'Ms. Lee, lee@lincoln.edu' })
    renderPage()
    expect(await screen.findByText('Contact: Ms. Lee, lee@lincoln.edu')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^The posting/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('starts nothing new once applied to', async () => {
    stub({
      ...POSTING,
      applied_on: '2026-10-01',
      locked: true,
      versions: POSTING.versions.map((use) => ({ ...use, locked: true })),
    })
    renderPage()
    expect(await screen.findByText(/You applied to this posting/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start a/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('sent')).toHaveLength(2)
    // Its header went out with them, so it's shown, not edited.
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    expect(screen.getByText('English Teacher')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save header' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("says when it doesn't exist, without a Retry", async () => {
    stubApi({
      'GET /api/job-postings/9': [{ status: 404, body: errorBody('NOT_FOUND', "That item doesn't exist.") }],
      'GET /api/headers': [{ status: 200, body: [] }],
      'GET /api/resumes': [{ status: 200, body: [] }],
      'GET /api/cover-letters': [{ status: 200, body: [] }],
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("That item doesn't exist.")
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when it fails to load', async () => {
    stub(POSTING, {
      'GET /api/job-postings/9': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: POSTING },
      ],
      'GET /api/headers': [{ status: 200, body: [TEACHER, SAM] }, { status: 200, body: [TEACHER, SAM] }],
      'GET /api/resumes': [{ status: 200, body: [] }, { status: 200, body: [] }],
      'GET /api/cover-letters': [{ status: 200, body: [] }, { status: 200, body: [] }],
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Resume for English Teacher at Lincoln High' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it is loading', async () => {
    stubPendingApi()
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Job posting' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('records the application, and an interview, from its tracking section', async () => {
    const tracked = { ...POSTING, applied_on: '2026-10-01', locked: true }
    const interviewed = { ...tracked, interviews: [{ interview_id: 1, interview_on: '2026-10-05', notes: null, also_for: [] }] }
    stub(POSTING, {
      'PUT /api/job-postings/9/tracking': [{ status: 200, body: tracked }],
      'POST /api/job-postings/9/interviews': [{ status: 201, body: interviewed }],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Application tracking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit tracking' }))
    fireEvent.change(screen.getByLabelText('Applied on'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved the tracking details.'))
    expect(await screen.findByText('You applied to this posting, so its resumes and cover letters are a record of what you sent.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }))
    fireEvent.change(screen.getByLabelText('Date (required)'), { target: { value: '2026-10-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Added the interview.'))
    expect(screen.getByRole('button', { name: 'Edit interview on October 5, 2026' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
