import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { expectNoA11yViolations } from './test/axe'

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
    await expectNoA11yViolations({ page: true })
  })

  it('shows the error message when the health check fails', async () => {
    const body = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', field: null } }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(body, { status: 500 }))))
    renderAt('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations({ page: true })
  })

  // Each library page inside the shell, as a whole page: landmarks, one h1, heading order.
  it.each([
    ['/library/headers', 'Headers', 'No headers yet.'],
    ['/library/sections', 'Sections', 'Add section'],
    ['/library/skills', 'Skills', 'No skills yet.'],
  ])('shows %s as a whole page, marked current in the nav', async (path, page, loadedText) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json([]))))
    renderAt(path)
    expect((await screen.findAllByText(loadedText)).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: page })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe(`${page} – Resume Tweaker`)
    await expectNoA11yViolations({ page: true })
  })

  it('shows a message for an unknown page', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAt('/nowhere')
    expect(screen.getByText("That page doesn't exist.")).toBeInTheDocument()
    await expectNoA11yViolations({ page: true })
  })
})
