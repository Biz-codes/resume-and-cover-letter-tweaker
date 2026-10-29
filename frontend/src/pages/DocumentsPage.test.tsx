import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import DocumentsPage from './DocumentsPage'

const INFO = { header_id: 1, tone_set_id: null, based_on: null, copies: [], updated_at: null }
const TECH = { ...INFO, resume_id: 1, name: 'Tech base', job_posting: null, locked: false }
const ACME = {
  ...INFO,
  resume_id: 2,
  name: 'Acme resume',
  job_posting: { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' },
  based_on: { id: 1, name: 'Tech base' },
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
    expect(bases).toHaveTextContent('Tech base')
    expect(screen.getByRole('link', { name: 'Tech base' })).toHaveAttribute('href', '/resumes/1')
    expect(tailored).toHaveTextContent('Acme resumesent for Acme: Engineer (copied from Tech base)')
    await expectNoA11yViolations()
  })

  it('creates a base version and opens it', async () => {
    const created = { ...TECH, resume_id: 3, name: 'Teaching base', output: { parts: [], text: '' } }
    const fetchMock = stub({ 'POST /api/resumes': [{ status: 201, body: created }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New base resume' }))
    const field = screen.getByLabelText('Name of the new base resume')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Teaching base' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create base resume' }))
    expect(await screen.findByRole('heading', { name: 'Opened resume' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'POST /api/resumes')).toEqual({ name: 'Teaching base' })
  })

  it('keeps the name and highlights it when creating fails', async () => {
    stub({ 'POST /api/resumes': [{ status: 422, body: errorBody('VALIDATION_FAILED', 'Name is required.', 'name') }] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New base resume' }))
    const field = screen.getByLabelText('Name of the new base resume')
    fireEvent.change(field, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create base resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveValue(' ')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New base resume' })).toHaveFocus())
  })

  it('shows the notice it was sent here with', async () => {
    stub({}, [])
    renderPage({ notice: 'Deleted "Old".' })
    expect(await screen.findByText('No base resumes yet.')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Deleted "Old".'))
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
    expect(await screen.findByRole('link', { name: 'Tech base' })).toBeInTheDocument()
  })
})
