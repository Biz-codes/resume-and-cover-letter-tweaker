import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Header } from '../api/headers'
import { expectNoA11yViolations } from '../../test/axe'
import HeaderFields from './HeaderFields'

const blank = { location: null, linkedin_url: null, github_url: null, portfolio_url: null, used_by: [] }
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

const options = (label: string) =>
  [...screen.getByLabelText(label).querySelectorAll('option')].map((option) => option.textContent)

describe('HeaderFields', () => {
  it('offers every saved value for each field, starting with the current header', async () => {
    render(<HeaderFields header={TECH} headers={[TEACHING, TECH]} readOnly={false} onSave={vi.fn()} />)
    expect(screen.getByLabelText('Headline')).toHaveValue('Front-End Engineer')
    expect(options('Headline')).toEqual(['None', 'New headline…', 'English Teacher', 'Front-End Engineer'])
    // The name is required, so it has no "None".
    expect(options('Name (required)')).toEqual(['New name…', 'Sam Rivera'])
    expect(screen.getByLabelText('Location')).toHaveValue('')
    // Nothing to save or undo yet.
    expect(screen.getByRole('button', { name: 'Save header' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Undo changes' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('saves nothing until Save header, then all the values together', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<HeaderFields header={TECH} headers={[TEACHING, TECH]} readOnly={false} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'English Teacher' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: '\u0000new' } })
    fireEvent.change(screen.getByLabelText('New location'), { target: { value: ' Portland, OR ' } })
    expect(onSave).not.toHaveBeenCalled()
    await expectNoA11yViolations()
    const save = screen.getByRole('button', { name: 'Save header' })
    fireEvent.click(save)
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
    // The typed value is now a saved one, and focus stays on the button.
    await vi.waitFor(() => expect(screen.getByLabelText('Location')).toHaveValue('Portland, OR'))
    expect(screen.queryByLabelText('New location')).not.toBeInTheDocument()
    expect(save).toBeInTheDocument()
  })

  it('saves when Enter is pressed in a typed value, and undoes changes', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<HeaderFields header={TECH} headers={[TECH]} readOnly={false} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }))
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com')
    expect(screen.getByRole('button', { name: 'Save header' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '\u0000new' } })
    const typed = screen.getByLabelText('New headline')
    // A typed value says what it holds, as the library's header form does (WCAG 1.3.5).
    expect(typed).toHaveAttribute('autocomplete', 'organization-title')
    fireEvent.change(typed, { target: { value: 'Tutor' } })
    fireEvent.submit(typed)
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headline: 'Tutor' })))
  })

  it('highlights the field a refusal names', async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Too long.', 'full_name', 422)))
    render(<HeaderFields header={undefined} headers={[]} readOnly={false} onSave={onSave} />)
    // With no saved headers, the name starts as a new one.
    const name = screen.getByLabelText('New name')
    fireEvent.change(name, { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Too long.')
    // The typed value stays, to fix.
    expect(name).toHaveValue('Sam')
    await expectNoA11yViolations()
  })

  it('starts from a suggestion and saves nothing until it is used', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const suggested = { ...TECH, headline: 'English Teacher', phone: null }
    render(<HeaderFields header={undefined} headers={[TECH]} suggested={suggested} readOnly={false} onSave={onSave} />)
    // Saved values are picked; a value no header has is typed in as a new one.
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('New headline')).toHaveValue('English Teacher')
    // Nothing to undo back to yet.
    expect(screen.queryByRole('button', { name: 'Undo changes' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '' } })
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
    refuse(new ApiError('VALIDATION_FAILED', 'Too long.', 'full_name', 422))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    expect(screen.getByLabelText('Name (required)')).toHaveAttribute('aria-invalid', 'true')
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
