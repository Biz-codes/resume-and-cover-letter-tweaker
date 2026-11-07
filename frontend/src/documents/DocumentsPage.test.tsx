import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import DocumentsPage from './DocumentsPage'
import { expectNotice } from '../test/notice'

const INFO = { header_id: 1, tone_set_id: null, based_on: null, hidden: false, copies: [], updated_at: null }
const TECH = { ...INFO, resume_id: 1, name: 'Tech', job_posting: null, locked: false }
const ACME = {
  ...INFO,
  resume_id: 2,
  name: 'Acme resume',
  job_posting: { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' },
  based_on: { id: 1, name: 'Tech Base Resume' },
  locked: true,
}

function stub(extra: Record<string, Reply[]> = {}, resumes: unknown[] = [TECH, ACME]) {
  return stubApi({ 'GET /api/resumes': [{ status: 200, body: resumes }], ...extra })
}

function renderPage(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/resumes', state }]}>
      <Routes>
        <Route path="/resumes" element={<DocumentsPage kind="resume" />} />
        <Route path="/resumes/:id" element={<h2>Opened resume</h2>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DocumentsPage', () => {
  it('lists base versions, then the ones for job postings', async () => {
    stub()
    renderPage()
    expect(document.title).toBe('Resumes – Resume Tweaker')
    const [bases, tailored] = await screen.findAllByRole('list')
    expect(bases).toHaveTextContent('Tech Base Resume')
    expect(screen.getByRole('link', { name: 'Tech Base Resume' })).toHaveAttribute('href', '/resumes/1')
    expect(tailored).toHaveTextContent('Acme resumesent for Acme: Engineer (copied from Tech Base Resume)')
    await expectNoA11yViolations()
  })

  it('lists hidden ones under Hidden, closed, and unhides one', async () => {
    const hidden = { ...ACME, hidden: true }
    const fetchMock = stub(
      {
        'PUT /api/resumes/2/hidden': [{ status: 200, body: ACME }],
        'GET /api/resumes': [{ status: 200, body: [TECH, hidden] }, { status: 200, body: [TECH, ACME] }],
      },
    )
    renderPage()
    const group = await screen.findByRole('button', { name: 'Hidden (1)' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('No resumes for job postings yet.')).toBeInTheDocument()
    fireEvent.click(group)
    await expectNoA11yViolations()
    // Not offered to start from.
    fireEvent.click(screen.getByRole('button', { name: 'New base resume' }))
    expect([...screen.getByLabelText('Start from').querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Fresh, with the usual defaults',
      'Tech Base Resume',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Unhide "Acme resume"' }))
    await expectNotice('Unhid "Acme resume".')
    expect(sentBody(fetchMock, 'PUT /api/resumes/2/hidden')).toEqual({ hidden: false })
    expect(screen.queryByRole('button', { name: 'Hidden (1)' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Acme resume' })).toHaveFocus())
  })

  it('creates a base version and opens it', async () => {
    const created = { ...TECH, resume_id: 3, name: 'Teaching', output: { parts: [], text: '' } }
    const fetchMock = stub({ 'POST /api/resumes': [{ status: 201, body: created }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New base resume' }))
    const field = screen.getByRole('textbox', { name: 'Name of the new base resume (required)' })
    await vi.waitFor(() => expect(field).toHaveFocus())
    // What the app adds after the name is shown beside the field, and read with it.
    expect(field).toHaveAccessibleDescription('Followed by "Base Resume".')
    // Fresh unless another is picked: base versions first, then the ones for postings.
    expect(screen.getByLabelText('Start from')).toHaveValue('')
    expect([...screen.getByLabelText('Start from').querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Fresh, with the usual defaults',
      'Tech Base Resume',
      'Acme resume (for Acme)',
    ])
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Teaching' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create base resume' }))
    expect(await screen.findByRole('heading', { name: 'Opened resume' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'POST /api/resumes')).toEqual({ name: 'Teaching' })
  })

  it('keeps the name and highlights it when creating fails', async () => {
    stub({ 'POST /api/resumes': [{ status: 422, body: errorBody('VALIDATION_FAILED', 'Name is required.', 'name') }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New base resume' }))
    const field = screen.getByRole('textbox', { name: 'Name of the new base resume (required)' })
    fireEvent.change(field, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create base resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Followed by "Base Resume". Name is required.')
    expect(field).toHaveValue(' ')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New base resume' })).toHaveFocus())
  })

  it('creates a base version as a copy of any existing one, base or tailored', async () => {
    const copied = { ...TECH, resume_id: 4, name: 'Acme base', based_on: { id: 2, name: 'Acme resume' }, output: { parts: [], text: '' } }
    const fetchMock = stub({ 'POST /api/resumes/2/copies': [{ status: 201, body: copied }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New base resume' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the new base resume (required)' }), { target: { value: 'Acme base' } })
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create base resume' }))
    expect(await screen.findByRole('heading', { name: 'Opened resume' })).toBeInTheDocument()
    // No posting, so it's a new base version; the original isn't changed.
    expect(sentBody(fetchMock, 'POST /api/resumes/2/copies')).toEqual({ name: 'Acme base' })
  })

  it('says it is creating', async () => {
    // The list loads; the create never answers, so the check sees the form mid-save.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === 'POST' ? new Promise<Response>(() => {}) : Promise.resolve(Response.json([TECH, ACME])),
      ),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New base resume' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the new base resume (required)' }), { target: { value: 'Draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create base resume' }))
    expect(await screen.findByRole('button', { name: 'Creating…' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('shows the notice it was sent here with', async () => {
    stub({}, [])
    renderPage({ notice: 'Deleted "Old".' })
    expect(await screen.findByText('No base resumes yet.')).toBeInTheDocument()
    await expectNotice('Deleted "Old".')
    expect(screen.getByText('No resumes for job postings yet.')).toBeInTheDocument()
  })

  it('names cover letters for their kind', async () => {
    stubApi({ 'GET /api/cover-letters': [{ status: 200, body: [] }] })
    render(
      <MemoryRouter>
        <DocumentsPage kind="cover_letter" />
      </MemoryRouter>,
    )
    expect(await screen.findByText('No base cover letters yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New base cover letter' })).toBeInTheDocument()
  })

  it('says it is loading', async () => {
    stubPendingApi()
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stubApi({
      'GET /api/resumes': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [TECH] },
      ],
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Tech Base Resume' })).toBeInTheDocument()
  })
})
