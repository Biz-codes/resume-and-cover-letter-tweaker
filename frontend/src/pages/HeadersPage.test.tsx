import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Header } from '../api/headers'
import HeadersPage from './HeadersPage'

const BASE: Header = {
  header_id: 1,
  full_name: 'Sam Rivera',
  headline: 'Software Engineer',
  email: 'sam@example.com',
  phone: null,
  location: null,
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
  used_by: [{ kind: 'resume', id: 1, name: 'Tech base', locked: false }],
}

const SENT: Header = {
  ...BASE,
  header_id: 2,
  headline: 'Front-End Engineer',
  used_by: [{ kind: 'resume', id: 2, name: 'Acme resume', locked: true }],
}

type Reply = { status: number; body?: unknown }

// Answers each request from the replies for its method and path, in order.
function stubApi(replies: Record<string, Reply[]>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const reply = replies[key]?.shift()
    if (!reply) throw new Error(`unexpected request: ${key}`)
    return Promise.resolve(
      reply.status === 204 ? new Response(null, { status: 204 }) : Response.json(reply.body, { status: reply.status }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentBody(fetchMock: ReturnType<typeof stubApi>, index: number) {
  return JSON.parse(fetchMock.mock.calls[index][1]?.body as string)
}

async function cardFor(headline: string) {
  return (await screen.findByText(headline)).closest('article') as HTMLElement
}

describe('HeadersPage', () => {
  it('lists headers with what uses them', async () => {
    stubApi({ 'GET /api/headers': [{ status: 200, body: [BASE, SENT] }] })
    render(<HeadersPage />)
    const sent = await cardFor('Front-End Engineer')
    expect(within(sent).getByText(/Acme resume/)).toBeInTheDocument()
    expect(within(sent).getByText('sent')).toBeInTheDocument()
  })

  it('adds a header, sending blank fields as empty', async () => {
    const created = { ...BASE, header_id: 3, headline: null, email: null, used_by: [] }
    const fetchMock = stubApi({
      'GET /api/headers': [{ status: 200, body: [] }, { status: 200, body: [created] }],
      'POST /api/headers': [{ status: 201, body: created }],
    })
    render(<HeadersPage />)
    fireEvent.click(await screen.findByText('New header'))
    fireEvent.change(screen.getByLabelText('Full name (required)'), { target: { value: 'Sam Rivera' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(sentBody(fetchMock, 1)).toMatchObject({ full_name: 'Sam Rivera', headline: null })
  })

  it('keeps the input and highlights the field when the backend rejects it', async () => {
    const error = { error: { code: 'VALIDATION_FAILED', message: 'Invalid full name.', field: 'full_name' } }
    stubApi({
      'GET /api/headers': [{ status: 200, body: [] }],
      'POST /api/headers': [{ status: 422, body: error }],
    })
    render(<HeadersPage />)
    fireEvent.click(await screen.findByText('New header'))
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Engineer' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid full name.')
    expect(screen.getByLabelText('Full name (required)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Headline')).toHaveValue('Engineer')
  })

  it('warns that editing a header a sent version uses saves a new one', async () => {
    const saved = { ...SENT, header_id: 5, phone: '555-0100', used_by: [] }
    stubApi({
      'GET /api/headers': [{ status: 200, body: [SENT] }, { status: 200, body: [saved, SENT] }],
      'PUT /api/headers/2': [{ status: 200, body: saved }],
    })
    render(<HeadersPage />)
    fireEvent.click(within(await cardFor('Front-End Engineer')).getByText('Edit'))
    expect(screen.getByText(/saved as a new header/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0100' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved as a new header.')
  })

  it('says when an identical header already existed', async () => {
    stubApi({
      'GET /api/headers': [{ status: 200, body: [BASE] }, { status: 200, body: [BASE] }],
      'POST /api/headers': [{ status: 200, body: BASE }],
    })
    render(<HeadersPage />)
    fireEvent.click(await screen.findByText('New header'))
    fireEvent.change(screen.getByLabelText('Full name (required)'), { target: { value: 'Sam Rivera' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('An identical header already exists')
  })

  it('lists what uses a header before deleting it', async () => {
    const fetchMock = stubApi({
      'GET /api/headers': [{ status: 200, body: [SENT] }, { status: 200, body: [] }],
      'DELETE /api/headers/2': [{ status: 204 }],
    })
    render(<HeadersPage />)
    fireEvent.click(within(await cardFor('Front-End Engineer')).getByText('Delete'))
    const confirm = screen.getByRole('group', { name: 'Confirm delete' })
    expect(confirm).toHaveTextContent('Acme resume')
    expect(confirm).toHaveTextContent('changes the record of what you sent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Header deleted.')
  })

  it('offers Retry when the list fails to load', async () => {
    const error = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', field: null } }
    stubApi({
      'GET /api/headers': [{ status: 500, body: error }, { status: 200, body: [BASE] }],
    })
    render(<HeadersPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByText('Software Engineer')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
