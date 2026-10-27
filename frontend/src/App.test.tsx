import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App', () => {
  it('shows that the backend is running', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))))
    renderAt('/')
    expect(await screen.findByText('Backend and database are running.')).toBeInTheDocument()
  })

  it('shows the error message when the health check fails', async () => {
    const body = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', field: null } }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(body, { status: 500 }))))
    renderAt('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
  })

  it('shows a message for an unknown page', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAt('/nowhere')
    expect(screen.getByText("That page doesn't exist.")).toBeInTheDocument()
  })
})
