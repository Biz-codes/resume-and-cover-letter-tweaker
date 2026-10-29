import { fireEvent, render, screen, within } from '@testing-library/react'
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
    ['/library/experience', 'Experience', 'No roles yet.'],
    ['/library/projects', 'Projects', 'No projects yet.'],
    ['/library/bullets', 'Bullet points', 'No bullets yet.'],
    ['/library/narrative-content', 'Narrative content', 'No narrative content yet.'],
    ['/library/education', 'Education', 'No education yet.'],
    ['/library/sign-offs', 'Sign-offs', 'No sign-offs yet.'],
    ['/library/writing-rules', 'Writing rules', 'None yet.'],
    ['/library/tone-sets', 'Tone sets', 'No tone sets yet.'],
  ])('shows %s as a whole page, marked current in the nav', async (path, page, loadedText) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json([]))))
    renderAt(path)
    expect((await screen.findAllByText(loadedText)).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: page })).toHaveAttribute('aria-current', 'page')
    // The main nav marks the library as the current section, not the current page, and no
    // other mode.
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: 'Resumes' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(document.title).toBe(`${page} – Resume Tweaker`)
    await expectNoA11yViolations({ page: true })
  })

  it('shows the library landing page, with its sub-nav', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAt('/library')
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation', { name: 'Library' })).toBeInTheDocument()
    await expectNoA11yViolations({ page: true })
  })

  it.each([
    ['/postings', 'Job postings'],
    ['/resumes', 'Resumes'],
    ['/cover-letters', 'Cover letters'],
  ])('shows %s as coming soon', async (path, page) => {
    vi.stubGlobal('fetch', vi.fn())
    renderAt(path)
    expect(screen.getByRole('heading', { level: 2, name: page })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: page })).toHaveAttribute('aria-current', 'page')
    await expectNoA11yViolations({ page: true })
  })

  it('leaves focus alone on the first page, then focuses each new page heading', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderAt('/')
    expect(document.body).toHaveFocus()
    // A choice on Home goes away with the page, so focus can't stay on it.
    fireEvent.click(screen.getByRole('link', { name: 'Browse your library' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Library' })).toHaveFocus()
    expect(document.title).toBe('Library – Resume Tweaker')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Library' })).getByRole('link', { name: 'Skills' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Skills' })).toHaveFocus()
    fireEvent.click(screen.getByRole('link', { name: 'Resumes' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Resumes' })).toHaveFocus()
    await expectNoA11yViolations({ page: true })
  })

  it('shows a message for an unknown page', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAt('/nowhere')
    expect(screen.getByRole('heading', { level: 2, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText("That page doesn't exist.")).toBeInTheDocument()
    await expectNoA11yViolations({ page: true })
  })
})
