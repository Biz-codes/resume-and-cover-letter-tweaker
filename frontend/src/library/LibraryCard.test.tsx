import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import LibraryCard from './LibraryCard'

describe('LibraryCard', () => {
  it('starts closed, with its buttons and what they opened showing either way', async () => {
    render(
      <LibraryCard title="Engineer, Acme" actions={<button type="button">Edit</button>} shown={<p>Delete it?</p>}>
        <p>Used by (2)</p>
      </LibraryCard>,
    )
    const toggle = screen.getByRole('button', { name: 'Engineer, Acme' })
    expect(screen.getByRole('heading', { level: 4, name: 'Engineer, Acme' })).toContainElement(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByText('Delete it?')).toBeInTheDocument()
    expect(screen.queryByText('Used by (2)')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(screen.getByText('Used by (2)'))
    await expectNoA11yViolations()
  })

  it('can sit under the page heading, and lets a form take the title’s place', async () => {
    const { rerender } = render(
      <LibraryCard title="Sincerely" heading={3}>
        <p>Used by (0)</p>
      </LibraryCard>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Sincerely' })).toBeInTheDocument()
    rerender(
      <LibraryCard title="Sincerely" heading={3} replacesTitle={<label>Sign-off<input /></label>}>
        <p>Used by (0)</p>
      </LibraryCard>,
    )
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Sign-off')).toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
