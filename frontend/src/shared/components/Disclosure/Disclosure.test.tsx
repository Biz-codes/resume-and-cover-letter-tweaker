import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../../test/axe'
import Disclosure from './Disclosure'

describe('Disclosure', () => {
  it('starts closed and opens to show what is under it', async () => {
    render(
      <Disclosure title="Sections (2)">
        <p>Summary</p>
      </Disclosure>,
    )
    const toggle = screen.getByRole('button', { name: 'Sections (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Summary')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Summary')).toBeVisible()
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(screen.getByText('Summary'))
    await expectNoA11yViolations()
    fireEvent.click(toggle)
    expect(screen.queryByText('Summary')).not.toBeInTheDocument()
  })

  it('marks open and closed with a chevron that screen readers skip, since they hear aria-expanded', () => {
    render(
      <Disclosure title="Sections (2)">
        <p>Summary</p>
      </Disclosure>,
    )
    const toggle = screen.getByRole('button', { name: 'Sections (2)' })
    const chevron = toggle.querySelector('svg')!
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron).toHaveClass('disclosure-mark')
    expect(toggle.textContent).toBe('Sections (2)')
  })

  it('can sit in a heading, so it is found by heading', async () => {
    render(
      <Disclosure title="Preview and copy" heading={3}>
        <h4>Summary</h4>
      </Disclosure>,
    )
    const toggle = screen.getByRole('button', { name: 'Preview and copy' })
    expect(screen.getByRole('heading', { level: 3, name: 'Preview and copy' })).toContainElement(toggle)
    fireEvent.click(toggle)
    expect(screen.getByRole('heading', { level: 4, name: 'Summary' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
