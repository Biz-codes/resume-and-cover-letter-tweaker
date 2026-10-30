import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
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
})
