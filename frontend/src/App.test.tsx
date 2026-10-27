import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  it('shows that the backend is running', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))))
    render(<App />)
    expect(await screen.findByText('Backend and database are running.')).toBeInTheDocument()
  })

  it('shows the error message when the health check fails', async () => {
    const body = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', field: null } }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(body, { status: 500 }))))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
  })
})
