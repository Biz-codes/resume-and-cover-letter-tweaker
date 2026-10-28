import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { expectNoA11yViolations } from '../test/axe'
import NameForm from './NameForm'

describe('NameForm', () => {
  it("doesn't take focus when it's always on the page", async () => {
    render(<NameForm label="New section title" field="title" submitLabel="Add section" onSave={vi.fn()} />)
    const input = screen.getByLabelText('New section title')
    expect(input).not.toHaveFocus()
    expect(input).toHaveAttribute('aria-required', 'true')
    await expectNoA11yViolations()
  })

  it('takes focus when it opens in place, and describes the input with the locked note', async () => {
    render(
      <NameForm
        label="Section title"
        field="title"
        initial="Freelance"
        lockedNote="A sent version uses this section."
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Section title')
    expect(input).toHaveFocus()
    expect(input).toHaveAccessibleDescription('A sent version uses this section.')
    await expectNoA11yViolations()
  })

  it('keeps the input, marks it invalid, and links the error to it', async () => {
    const onSave = vi.fn(() =>
      Promise.reject(new ApiError('DUPLICATE', 'There\'s already a section named "Skills".', 'title', 409)),
    )
    render(<NameForm label="New section title" field="title" submitLabel="Add section" onSave={onSave} />)
    const input = screen.getByLabelText('New section title')
    fireEvent.change(input, { target: { value: 'skills' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already a section named "Skills"')
    expect(input).toHaveValue('skills')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('There\'s already a section named "Skills".')
    await expectNoA11yViolations()
  })

  it('ignores a second submit while saving, without disabling the focused button', async () => {
    let finish = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<NameForm label="New section title" field="title" submitLabel="Add section" onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    const saving = await screen.findByRole('button', { name: 'Saving…' })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    expect(saving).toBeEnabled()
    await expectNoA11yViolations()
    fireEvent.click(saving)
    expect(onSave).toHaveBeenCalledTimes(1)
    finish()
    expect(await screen.findByRole('button', { name: 'Add section' })).toBeInTheDocument()
  })
})
