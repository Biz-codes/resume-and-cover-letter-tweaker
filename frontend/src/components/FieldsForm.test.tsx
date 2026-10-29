import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { expectNoA11yViolations } from '../test/axe'
import FieldsForm, { type Field } from './FieldsForm'

type Role = { role_title: string; organization: string; dates: string | null }

const FIELDS: Field<Role>[] = [
  { name: 'role_title', label: 'Role title', required: true },
  { name: 'organization', label: 'Organization', required: true },
  { name: 'dates', label: 'Dates' },
]
const ROLE: Role = { role_title: 'Engineer', organization: 'Acme', dates: null }

describe('FieldsForm', () => {
  it('takes focus, marks required fields, and saves the values', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<FieldsForm label="New role" fields={FIELDS} initial={ROLE} onSave={onSave} onCancel={vi.fn()} />)
    expect(screen.getByRole('form', { name: 'New role' })).toBeInTheDocument()
    const title = screen.getByLabelText('Role title (required)')
    expect(title).toHaveFocus()
    expect(title).toHaveAttribute('aria-required', 'true')
    expect(screen.getByLabelText('Dates')).not.toHaveAttribute('aria-required')
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Dates'), { target: { value: '2020' } })
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith({ ...ROLE, dates: '2020' })
  })

  it('describes the first field with the note', () => {
    render(
      <FieldsForm
        label="Edit role"
        fields={FIELDS}
        initial={ROLE}
        note="A sent version uses this role."
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Role title (required)')).toHaveAccessibleDescription('A sent version uses this role.')
    expect(screen.getByLabelText('Organization (required)')).not.toHaveAccessibleDescription()
  })

  it('keeps the input and links the error to the field it names', async () => {
    const onSave = vi.fn(() =>
      Promise.reject(new ApiError('VALIDATION_FAILED', 'Organization is required.', 'organization', 422)),
    )
    render(<FieldsForm label="New role" fields={FIELDS} initial={ROLE} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: ' ' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Organization is required.')
    const organization = screen.getByLabelText('Organization (required)')
    expect(organization).toHaveValue(' ')
    expect(organization).toHaveAttribute('aria-invalid', 'true')
    expect(organization).toHaveAccessibleDescription('Organization is required.')
  })

  it('ignores a second submit while saving, without disabling the focused button', async () => {
    let finish = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<FieldsForm label="New role" fields={FIELDS} initial={ROLE} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('Save'))
    const saving = await screen.findByRole('button', { name: 'Saving…' })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
    fireEvent.click(saving)
    expect(onSave).toHaveBeenCalledTimes(1)
    finish()
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows extra controls and cancels', () => {
    const onCancel = vi.fn()
    render(
      <FieldsForm label="New role" fields={FIELDS} initial={ROLE} onSave={vi.fn()} onCancel={onCancel}>
        <p>Extra</p>
      </FieldsForm>,
    )
    expect(screen.getByText('Extra')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows a multiline field as a text area, and focuses the first field either way', async () => {
    type Entry = { details: string | null; degree: string }
    const fields: Field<Entry>[] = [
      { name: 'details', label: 'Details', multiline: true },
      { name: 'degree', label: 'Degree' },
    ]
    const onSave = vi.fn(() => Promise.resolve())
    render(
      <FieldsForm label="New entry" fields={fields} initial={{ details: null, degree: '' }} onSave={onSave} onCancel={vi.fn()} />,
    )
    const details = screen.getByLabelText('Details')
    expect(details.tagName).toBe('TEXTAREA')
    expect(details).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(details, { target: { value: 'Two lines\nof details' } })
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith({ details: 'Two lines\nof details', degree: '' })
  })
})
