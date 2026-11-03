import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import PostingsPage from './PostingsPage'
import { expectNotice } from '../test/notice'

const posting = (id: number, organization: string, extra = {}) => ({
  job_posting_id: id,
  url: 'https://example.com/jobs/1',
  organization,
  role_title: 'Engineer',
  description: 'Build things.',
  header_id: 1,
  applied_on: null,
  locked: false,
  versions: [],
  updated_at: null,
  ...extra,
})
const ACME = posting(4, 'Acme', {
  applied_on: '2026-10-01',
  locked: true,
  versions: [
    { kind: 'resume', id: 2, name: 'Acme resume', locked: true },
    { kind: 'cover_letter', id: 3, name: 'Acme letter', locked: true },
  ],
})
const BETA = posting(5, 'Beta', { versions: [{ kind: 'resume', id: 6, name: 'Beta resume', locked: false }] })

function stub(extra: Record<string, Reply[]> = {}, postings: unknown[] = [ACME, BETA]) {
  return stubApi({ 'GET /api/job-postings': [{ status: 200, body: postings }], ...extra })
}

function renderPage(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/postings', state }]}>
      <Routes>
        <Route path="/postings" element={<PostingsPage />} />
        <Route path="/postings/:id" element={<h2>Opened posting</h2>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PostingsPage', () => {
  it('lists the postings, with how many versions each has', async () => {
    stub()
    renderPage()
    expect(document.title).toBe('Job postings – Resume Tweaker')
    const list = await screen.findByRole('list')
    expect(list).toHaveTextContent('Engineer at Acmeapplied (1 resume, 1 cover letter)')
    expect(list).toHaveTextContent('Engineer at Beta (1 resume, 0 cover letters)')
    expect(screen.getByRole('link', { name: 'Engineer at Beta' })).toHaveAttribute('href', '/postings/5')
    await expectNoA11yViolations()
  })

  it('saves a new posting and opens it', async () => {
    const fetchMock = stub({ 'POST /api/job-postings': [{ status: 201, body: posting(7, 'Lincoln High') }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New job posting' }))
    const url = screen.getByLabelText('Link to the posting or primary contact (required)')
    expect(url).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(url, { target: { value: 'https://example.com/jobs/7' } })
    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: 'Lincoln High' } })
    fireEvent.change(screen.getByLabelText('Role title (required)'), { target: { value: 'English Teacher' } })
    fireEvent.change(screen.getByLabelText('Job description (paste it in) (required)'), {
      target: { value: 'Teach ninth grade.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save posting' }))
    expect(await screen.findByRole('heading', { name: 'Opened posting' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'POST /api/job-postings')).toEqual({
      url: 'https://example.com/jobs/7',
      organization: 'Lincoln High',
      role_title: 'English Teacher',
      description: 'Teach ninth grade.',
    })
  })

  it('keeps the input and highlights the field a refusal names', async () => {
    stub({
      'POST /api/job-postings': [
        { status: 422, body: errorBody('VALIDATION_FAILED', 'Invalid description: required.', 'description') },
      ],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New job posting' }))
    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: 'Lincoln High' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save posting' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid description')
    expect(screen.getByLabelText('Job description (paste it in) (required)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Organization (required)')).toHaveValue('Lincoln High')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New job posting' })).toHaveFocus())
  })

  it('says when there are none, and shows the notice it was sent with', async () => {
    stub({}, [])
    renderPage({ notice: 'Deleted "Engineer at Acme".' })
    expect(await screen.findByText('No job postings yet.')).toBeInTheDocument()
    await expectNotice('Deleted "Engineer at Acme".')
    await expectNoA11yViolations()
  })

  it('says it is loading', async () => {
    stubPendingApi()
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when loading fails', async () => {
    stubApi({
      'GET /api/job-postings': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [] },
      ],
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No job postings yet.')).toBeInTheDocument()
  })
})
