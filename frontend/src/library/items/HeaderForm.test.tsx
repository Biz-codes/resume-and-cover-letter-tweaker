import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { expectNoA11yViolations } from '../../test/axe'
import HeaderForm from './HeaderForm'
import { EMPTY_HEADER as EMPTY } from './itemFields'

describe('HeaderForm', () => {
  it('focuses its first field, describes it with the note, and fills in the user’s details', async () => {
    render(
      <HeaderForm label="Edit header" initial={{ ...EMPTY, full_name: 'Sam Rivera' }} note="Saving adds a new header." onSave={vi.fn()} onCancel={vi.fn()}>
        <p>Checklist</p>
      </HeaderForm>,
    )
    const name = screen.getByLabelText('Full name (required)')
    expect(name).toHaveFocus()
    expect(name).toHaveAccessibleDescription('Saving adds a new header.')
    expect(screen.getByText('Checklist')).toBeInTheDocument()
    expect(name).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    // Every field for the user's own details says what it holds (WCAG 1.3.5).
    expect(
      ['Headline', 'Email', 'Phone', 'Location', 'LinkedIn URL', 'GitHub URL', 'Portfolio URL'].map((label) =>
        screen.getByLabelText(label).getAttribute('autocomplete'),
      ),
    ).toEqual(['organization-title', 'email', 'tel', 'address-level2', 'url', 'url', 'url'])
    await expectNoA11yViolations()
  })

  it('keeps the input and highlights the field a failed save names', async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Headline is too long.', 'headline', 422)))
    render(<HeaderForm label="New header" initial={EMPTY} submitLabel="Add header" onSave={onSave} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Full name (required)')).not.toHaveAccessibleDescription()
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Engineer' } })
    fireEvent.click(screen.getByText('Add header'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Headline is too long.')
    expect(screen.getByLabelText('Headline')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Headline')).toHaveValue('Engineer')
    await expectNoA11yViolations()
  })
})
