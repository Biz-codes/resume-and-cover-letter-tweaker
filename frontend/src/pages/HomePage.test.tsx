import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, stubPendingApi } from '../test/stubApi'
import HomePage from './HomePage'

describe('HomePage', () => {
  it('says it is checking the backend', async () => {
    stubPendingApi()
    render(<HomePage />)
    expect(screen.getByText('Checking the backend…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('says the backend is running, under the app title', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))))
    render(<HomePage />)
    expect(await screen.findByText('Backend and database are running.')).toBeInTheDocument()
    expect(document.title).toBe('Resume Tweaker')
    await expectNoA11yViolations()
  })

  it('shows a failed check as an alert', async () => {
    const body = errorBody('INTERNAL_ERROR', 'Something went wrong.')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(body, { status: 500 }))))
    render(<HomePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
  })
})
