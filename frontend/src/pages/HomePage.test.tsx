import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, stubPendingApi } from '../test/stubApi'
import HomePage from './HomePage'

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )

describe('HomePage', () => {
  it('asks what the user wants to do, marking what is coming soon', async () => {
    stubPendingApi()
    renderHome()
    expect(screen.getByRole('heading', { level: 2, name: 'What do you want to do?' })).toBeInTheDocument()
    const library = screen.getByRole('link', { name: 'Browse your library' })
    expect(library).toHaveAttribute('href', '/library')
    expect(library.parentElement).not.toHaveTextContent('coming soon')
    expect(library).toHaveAccessibleDescription(/^Everything a resume or cover letter can draw from/)
    const resume = screen.getByRole('link', { name: 'Create a resume' })
    expect(within(resume.parentElement as HTMLElement).getByText('coming soon')).toBeInTheDocument()
    // Read with the link, for screen reader users moving from link to link.
    expect(resume).toHaveAccessibleDescription(/^coming soon Build a resume from your library/)
    await expectNoA11yViolations()
  })

  it('says it is checking the backend', async () => {
    stubPendingApi()
    renderHome()
    expect(screen.getByText('Checking the backend…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('says the backend is running, under the app title', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))))
    renderHome()
    expect(await screen.findByText('Backend and database are running.')).toBeInTheDocument()
    expect(document.title).toBe('Resume Tweaker')
    await expectNoA11yViolations()
  })

  it('shows a failed check as an alert', async () => {
    const body = errorBody('INTERNAL_ERROR', 'Something went wrong.')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(body, { status: 500 }))))
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
  })
})
