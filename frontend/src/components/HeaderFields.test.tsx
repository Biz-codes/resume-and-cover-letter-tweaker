import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Header } from '../api/headers'
import { expectNoA11yViolations } from '../test/axe'
import HeaderFields from './HeaderFields'

const blank = { location: null, linkedin_url: null, github_url: null, portfolio_url: null, used_by: [] }
const TECH: Header = {
  header_id: 1,
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
    expect(options('Headline')).toEqual(['None', 'English Teacher', 'Front-End Engineer', 'New headline…'])
    // The name is required, so it has no "None".
    expect(options('Name (required)')).toEqual(['Sam Rivera', 'New name…'])
    expect(screen.getByRole('group', { name: 'Header' })).toHaveAccessibleDescription(
      'Each choice saves right away. A new value saves when you leave its field or press Enter.',
    )
    expect(screen.getByLabelText('Location')).toHaveValue('')
    await expectNoA11yViolations()
  })

  it('saves each choice as it is made, keeping the other values', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<HeaderFields header={TECH} headers={[TEACHING, TECH]} readOnly={false} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'English Teacher' } })
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith({
        full_name: 'Sam Rivera',
        headline: 'English Teacher',
        email: 'sam@example.com',
        phone: '555-0100',
        location: null,
        linkedin_url: null,
        github_url: null,
        portfolio_url: null,
      }),
    )
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '' } })
    await vi.waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ phone: null })))
  })

  it('saves a new value once it is typed, when the field is left or Enter is pressed', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<HeaderFields header={TECH} headers={[TECH]} readOnly={false} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: '\u0000new' } })
    // Choosing "New location…" saves nothing yet.
    expect(onSave).not.toHaveBeenCalled()
    const typed = screen.getByLabelText('New location')
    await expectNoA11yViolations()
    fireEvent.blur(typed)
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(typed, { target: { value: ' Portland, OR ' } })
    fireEvent.keyDown(typed, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ location: 'Portland, OR', headline: TECH.headline })),
    )
    // The typed value is now a saved one.
    await vi.waitFor(() => expect(screen.getByLabelText('Location')).toHaveValue('Portland, OR'))
    expect(screen.queryByLabelText('New location')).not.toBeInTheDocument()
  })

  it('highlights the field a refusal names', async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Too long.', 'full_name', 422)))
    render(<HeaderFields header={undefined} headers={[]} readOnly={false} onSave={onSave} />)
    // With no saved headers, the name starts as a new one.
    const name = screen.getByLabelText('New name')
    fireEvent.change(name, { target: { value: 'Sam' } })
    fireEvent.blur(name)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Too long.')
    // The typed value stays, to fix.
    expect(name).toHaveValue('Sam')
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
