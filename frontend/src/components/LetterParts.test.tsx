import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { DocDetail } from '../api/documents'
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
  copies: [],
  updated_at: null,
  sections: [],
  output: { parts: [], text: '' },
}
const SIGN_OFFS = [
  { sign_off_id: 3, text: 'Sincerely', used_by: [] },
  { sign_off_id: 4, text: 'Best regards', used_by: [] },
]

describe('Greeting', () => {
  it('saves who the letter is addressed to, or none, when the field is left', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<Greeting doc={LETTER} readOnly={false} onSave={onSave} />)
    const field = screen.getByLabelText(/Who it's addressed to/)
    expect(field).toHaveValue('Hiring Team')
    // How it saves is shown, and read with the field.
    expect(field).toHaveAccessibleDescription('Saves when you leave the field or press Enter.')
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
    const field = screen.getByLabelText(/Who it's addressed to/)
    fireEvent.change(field, { target: { value: 'The hiring team at a very long name' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long.')
    expect(screen.getByLabelText(/Who it's addressed to/)).toHaveAccessibleDescription(
      'Saves when you leave the field or press Enter. Too long.',
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

describe('SignOffPart', () => {
  it('saves the sign-off when chosen, and the name under it when the field is left', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<SignOffPart doc={LETTER} signOffs={SIGN_OFFS} readOnly={false} onSave={onSave} />)
    await expectNoA11yViolations()
    fireEvent.change(screen.getByRole('combobox', { name: 'Sign-off' }), { target: { value: '4' } })
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ sign_off_id: 4 }))
    const name = screen.getByLabelText(/Name under the sign-off/)
    fireEvent.change(name, { target: { value: 'Sam' } })
    fireEvent.blur(name)
    await vi.waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ signature_name: 'Sam' }))
  })

  it("shows a refusal on the sign-off's field", async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('NOT_FOUND', 'That sign-off is gone.', 'sign_off_id', 404)))
    render(<SignOffPart doc={LETTER} signOffs={SIGN_OFFS} readOnly={false} onSave={onSave} />)
    const select = screen.getByRole('combobox', { name: 'Sign-off' })
    fireEvent.change(select, { target: { value: '4' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('That sign-off is gone.')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    await expectNoA11yViolations()
  })

  it('shows the sign-off when read-only, or that there is none', () => {
    render(<SignOffPart doc={LETTER} signOffs={SIGN_OFFS} readOnly onSave={vi.fn()} />)
    expect(screen.getByText("Sincerely, The header's name")).toBeInTheDocument()
  })

  it('says when there is no sign-off', () => {
    render(<SignOffPart doc={{ ...LETTER, sign_off_id: null }} signOffs={SIGN_OFFS} readOnly onSave={vi.fn()} />)
    expect(screen.getByText(/No sign-off\./)).toBeInTheDocument()
  })
})
