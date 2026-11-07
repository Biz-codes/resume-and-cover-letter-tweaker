import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Header } from '../api/headers'
import { expectNoA11yViolations } from '../../test/axe'
import HeaderFields from './HeaderFields'

const blank = { location: null, linkedin_url: null, github_url: null, portfolio_url: null, used_by: [], in_progress: [] }
const TECH: Header = {
  hidden: false,
  header_id: 1,
  created_at: '2026-10-01T09:00:00',
  full_name: 'Sam Rivera',
  headline: 'Front-End Engineer',
  email: 'sam@example.com',
  phone: '555-0100',
  ...blank,
}
const TEACHING: Header = { ...TECH, header_id: 2, headline: 'English Teacher', email: 'sam@school.org', phone: null }

const more = (field: string) => screen.getByLabelText(`More ${field} options`)
const options = (field: string) => [...more(field).querySelectorAll('option')].map((option) => option.textContent)
const pick = (field: string, value: string) => fireEvent.change(more(field), { target: { value } })
// The current value, as the field shows it under its name.
const shown = (field: string) => screen.getByRole('button', { name: `New ${field}` }).closest('div')?.parentElement
  ?.querySelector('p span')?.textContent
const said = () => document.querySelector('[aria-live="polite"]')?.textContent

// Opens the modal for a new value, types it, and applies it.
function typeNew(field: string, label: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: `New ${field}` }))
  const dialog = screen.getByRole('dialog', { name: `New ${field}` })
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
}

describe('HeaderFields', () => {
  it('shows each current value under its name, with the other saved values under More options', async () => {
    render(<HeaderFields header={TECH} headers={[TEACHING, TECH]} readOnly={false} onSave={vi.fn()} />)
    // The dropdown is read with the value it would change.
    expect(more('headline')).toHaveAccessibleDescription('Front-End Engineer')
    expect(more('headline')).toHaveValue('')
    expect(options('headline')).toEqual(['Choose…', 'None', 'English Teacher'])
    // The name is required, so it has no "None", and with no other saved name there's no
    // dropdown, only New.
    expect(screen.queryByLabelText('More name options')).not.toBeInTheDocument()
    expect(shown('name')).toBe('Sam Rivera')
    expect(screen.getByRole('button', { name: 'New name' })).toBeInTheDocument()
    expect(shown('location')).toBe('None')
    expect(screen.queryByLabelText('More location options')).not.toBeInTheDocument()
    // Nothing to save or undo yet.
    expect(screen.getByRole('button', { name: 'Save header' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Undo changes' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('applies a pick right away and says so, showing it until focus leaves the dropdown', () => {
    render(<HeaderFields header={TECH} headers={[TEACHING, TECH]} readOnly={false} onSave={vi.fn()} />)
    more('headline').focus()
    pick('headline', 'English Teacher')
    expect(shown('headline')).toBe('English Teacher')
    expect(said()).toBe('Headline changed to English Teacher.')
    // Arrow keys change a closed dropdown on some systems, so it keeps the pick until focus
    // leaves, and they can move on through the options.
    expect(more('headline')).toHaveValue('English Teacher')
    expect(options('headline')).toEqual(['Choose…', 'None', 'English Teacher', 'Front-End Engineer'])
    pick('headline', '\u0000none')
    expect(said()).toBe('Headline changed to None.')
    fireEvent.blur(more('headline'))
    expect(more('headline')).toHaveValue('')
    expect(shown('headline')).toBe('None')
  })

  it('saves nothing until Save header, then all the values together', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<HeaderFields header={TECH} headers={[TEACHING, TECH]} readOnly={false} onSave={onSave} />)
    pick('headline', 'English Teacher')
    pick('phone', '\u0000none')
    typeNew('location', 'Location', ' Portland, OR ')
    expect(shown('location')).toBe('Portland, OR')
    expect(onSave).not.toHaveBeenCalled()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }))
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        full_name: 'Sam Rivera',
        headline: 'English Teacher',
        email: 'sam@example.com',
        phone: null,
        location: 'Portland, OR',
        linkedin_url: null,
        github_url: null,
        portfolio_url: null,
      }),
    )
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('types a new value in a modal, whose Apply only puts it in the form', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<HeaderFields header={TECH} headers={[TECH]} readOnly={false} onSave={onSave} />)
    const opener = screen.getByRole('button', { name: 'New headline' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'New headline' })
    const typed = within(dialog).getByLabelText('Headline')
    // A typed value says what it holds, as the library's header form does (WCAG 1.3.5).
    expect(typed).toHaveAttribute('autocomplete', 'organization-title')
    await expectNoA11yViolations()
    // Applying nothing says so, and keeps it open.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Type the new headline.')
    expect(typed).toHaveAccessibleDescription('Type the new headline.')
    await expectNoA11yViolations()
    fireEvent.change(typed, { target: { value: 'Tutor' } })
    // Enter applies it, as Apply does.
    fireEvent.submit(typed)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(shown('headline')).toBe('Tutor')
    // Focus goes back to the button, and the change is said once the modal is gone.
    expect(opener).toHaveFocus()
    await vi.waitFor(() => expect(said()).toBe('Headline changed to Tutor.'))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headline: 'Tutor' })))
  })

  it('cancels a new value and undoes changes', () => {
    render(<HeaderFields header={TECH} headers={[TECH]} readOnly={false} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(shown('email')).toBe('sam@example.com')
    pick('email', '\u0000none')
    expect(shown('email')).toBe('None')
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }))
    expect(shown('email')).toBe('sam@example.com')
    expect(said()).toBe('Undid the header changes.')
    expect(screen.getByRole('button', { name: 'Save header' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('highlights the field a refusal names', async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Too long.', 'full_name', 422)))
    render(<HeaderFields header={undefined} headers={[]} readOnly={false} onSave={onSave} />)
    typeNew('name', 'Name', 'Sam')
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    // With nothing else to pick, the error is read with the field's New button.
    expect(screen.getByRole('button', { name: 'New name' })).toHaveAccessibleDescription('Too long.')
    await expectNoA11yViolations()
  })

  it('starts from a suggestion and saves nothing until it is used', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const suggested = { ...TECH, headline: 'English Teacher', phone: null }
    render(<HeaderFields header={undefined} headers={[TECH]} suggested={suggested} readOnly={false} onSave={onSave} />)
    // Each suggested value is shown, whether a saved header has it or not.
    expect(more('headline')).toHaveAccessibleDescription('English Teacher')
    expect(shown('phone')).toBe('None')
    expect(options('headline')).toEqual(['Choose…', 'None', 'Front-End Engineer'])
    // Nothing to undo back to yet.
    expect(screen.queryByRole('button', { name: 'Undo changes' })).not.toBeInTheDocument()
    pick('email', '\u0000none')
    expect(onSave).not.toHaveBeenCalled()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Use this header' }))
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        full_name: 'Sam Rivera',
        headline: 'English Teacher',
        email: null,
        phone: null,
        location: null,
        linkedin_url: null,
        github_url: null,
        portfolio_url: null,
      }),
    )
  })

  it('says it is saving the suggestion, and shows a refusal', async () => {
    let refuse: (error: Error) => void = () => {}
    const onSave = vi.fn(() => new Promise<void>((_, reject) => (refuse = reject)))
    render(<HeaderFields header={undefined} headers={[TECH]} suggested={TECH} readOnly={false} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use this header' }))
    expect(await screen.findByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
    refuse(new ApiError('VALIDATION_FAILED', 'Too long.', 'headline', 422))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    expect(more('headline')).toHaveAttribute('aria-invalid', 'true')
    await expectNoA11yViolations()
  })

  it('lists the values when read-only', async () => {
    render(<HeaderFields header={TECH} headers={[TECH]} readOnly onSave={vi.fn()} />)
    expect(screen.getByText('sam@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('says when there is no header', () => {
    render(<HeaderFields header={undefined} headers={[]} readOnly onSave={vi.fn()} />)
    expect(screen.getByText('No header.')).toBeInTheDocument()
  })
})
