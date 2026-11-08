import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../shared/api/client'
import type { DocDetail } from '../shared/api/documents'
import { expectNoA11yViolations } from '../test/axe'
import { Greeting, SignOffPart } from './LetterParts'

const LETTER: DocDetail = {
  id: 1,
  name: 'General',
  header_id: null,
  tone_set_id: null,
  addressee: 'Hiring Team',
  sign_off_id: 3,
  signature_name: null,
  job_posting: null,
  based_on: null,
  locked: false,
  hidden: false,
  copies: [],
  updated_at: null,
  sections: [],
  output: { parts: [], text: '' },
  draft: null,
}
const SIGN_OFFS = [
  { sign_off_id: 3, text: 'Sincerely', hidden: false, used_by: [] },
  { sign_off_id: 4, text: 'Best regards', hidden: false, used_by: [] },
]

describe('Greeting', () => {
  it('saves who the letter is addressed to, or none, when the field is left', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<Greeting doc={LETTER} readOnly={false} onSave={onSave} />)
    const field = screen.getByLabelText('Addressed to (after "Dear")')
    expect(field).toHaveValue('Hiring Team')
    await expectNoA11yViolations()
    // Unchanged, nothing saves.
    fireEvent.blur(field)
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ addressee: null }))
  })

  it('shows a refusal on its field', async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Too long.', 'addressee', 422)))
    render(<Greeting doc={LETTER} readOnly={false} onSave={onSave} />)
    const field = screen.getByLabelText('Addressed to (after "Dear")')
    fireEvent.change(field, { target: { value: 'The hiring team at a very long name' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    expect(screen.getByLabelText('Addressed to (after "Dear")')).toHaveAccessibleDescription(
      'Too long.',
    )
    await expectNoA11yViolations()
  })

  it('shows the greeting when read-only', () => {
    render(<Greeting doc={LETTER} readOnly onSave={vi.fn()} />)
    expect(screen.getByText('Dear Hiring Team,')).toBeInTheDocument()
  })

  it('says when there is no greeting', () => {
    render(<Greeting doc={{ ...LETTER, addressee: null }} readOnly onSave={vi.fn()} />)
    expect(screen.getByText('No greeting.')).toBeInTheDocument()
  })
})

// The props every SignOffPart test shares.
const PART = { signOffs: SIGN_OFFS, headerName: 'Sam Rivera', onWrite: vi.fn(() => Promise.resolve(null)) }

describe('SignOffPart', () => {
  it('saves the sign-off when chosen, and the name under it when the field is left', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<SignOffPart {...PART} doc={LETTER} readOnly={false} onSave={onSave} />)
    await expectNoA11yViolations()
    fireEvent.change(screen.getByRole('combobox', { name: 'Sign-off' }), { target: { value: '4' } })
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ sign_off_id: 4 }))
    const name = screen.getByLabelText('Name under the sign-off')
    // It starts as the header's name.
    expect(name).toHaveValue('Sam Rivera')
    fireEvent.change(name, { target: { value: 'Sam' } })
    fireEvent.blur(name)
    await vi.waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ signature_name: 'Sam' }))
  })

  it("stores the header's name, or nothing, as empty, so it follows the header", async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<SignOffPart {...PART} doc={{ ...LETTER, signature_name: 'Sam' }} readOnly={false} onSave={onSave} />)
    const name = screen.getByLabelText('Name under the sign-off')
    expect(name).toHaveValue('Sam')
    fireEvent.change(name, { target: { value: 'Sam Rivera' } })
    fireEvent.blur(name)
    await vi.waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ signature_name: null }))
  })

  it('offers no hidden sign-off, apart from the one the letter already has', () => {
    const signOffs = [
      { ...SIGN_OFFS[0], hidden: true },
      { ...SIGN_OFFS[1], hidden: true },
      { sign_off_id: 5, text: 'Thanks', hidden: false, used_by: [] },
    ]
    render(<SignOffPart {...PART} signOffs={signOffs} doc={LETTER} readOnly={false} onSave={vi.fn()} />)
    const select = screen.getByRole('combobox', { name: 'Sign-off' })
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'No sign-off',
      'Sincerely',
      'Thanks',
    ])
  })

  it("saves nothing when the header's name is left as it is", () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<SignOffPart {...PART} doc={LETTER} readOnly={false} onSave={onSave} />)
    fireEvent.blur(screen.getByLabelText('Name under the sign-off'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('writes a new sign-off and picks it, with focus going in and back', async () => {
    const onWrite = vi.fn(() => Promise.resolve(9))
    render(<SignOffPart {...PART} doc={LETTER} readOnly={false} onSave={vi.fn()} onWrite={onWrite} />)
    fireEvent.click(screen.getByRole('button', { name: 'New sign-off' }))
    const field = screen.getByLabelText('New sign-off')
    await vi.waitFor(() => expect(field).toHaveFocus())
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Warm regards' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add sign-off' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New sign-off' })).toHaveFocus())
    expect(onWrite).toHaveBeenCalledWith('Warm regards')
  })

  it("shows a refusal on the sign-off's field", async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('NOT_FOUND', 'That sign-off is gone.', 'sign_off_id', 404)))
    render(<SignOffPart {...PART} doc={LETTER} readOnly={false} onSave={onSave} />)
    const select = screen.getByRole('combobox', { name: 'Sign-off' })
    fireEvent.change(select, { target: { value: '4' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('That sign-off is gone.')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    await expectNoA11yViolations()
  })

  it("shows the sign-off when read-only, with the header's name", () => {
    render(<SignOffPart {...PART} doc={LETTER} readOnly onSave={vi.fn()} />)
    expect(screen.getByText('Sincerely, Sam Rivera')).toBeInTheDocument()
  })

  it('says when there is no sign-off', () => {
    render(<SignOffPart {...PART} doc={{ ...LETTER, sign_off_id: null }} readOnly onSave={vi.fn()} />)
    expect(screen.getByText(/No sign-off\./)).toBeInTheDocument()
  })
})
