import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LibraryHome, LibraryLayout } from './LibraryPage'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library" element={<LibraryLayout />}>
          <Route index element={<LibraryHome />} />
          <Route path="skills" element={<h2>Skills page</h2>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('LibraryPage', () => {
  it('lists what each library page holds', () => {
    renderAt('/library')
    expect(document.title).toBe('Library – Resume Tweaker')
    const choices = screen.getByRole('list')
    const bullets = within(choices).getByRole('link', { name: 'Bullet points' })
    expect(bullets).toHaveAttribute('href', '/library/bullets')
    expect(bullets).toHaveAccessibleDescription('Every bullet, and where each is listed.')
    expect(within(choices).getByText('Skill categories and the skills in each.')).toBeInTheDocument()
  })

  it('shows its pages in a named sub-nav, marking the current one', () => {
    renderAt('/library/skills')
    const nav = screen.getByRole('navigation', { name: 'Library' })
    expect(within(nav).getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Skills page' })).toBeInTheDocument()
  })
})
