import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { expectNoA11yViolations } from '../test/axe'
import ConfirmDelete from './ConfirmDelete'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }

function renderConfirm(error: ApiError | null = null) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDelete
      what='"Freelance"'
      uses={[SENT]}
      effect="It's removed from them."
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmDelete', () => {
  it('is named by its question and starts on Cancel', async () => {
    renderConfirm()
    const confirm = screen.getByRole('group', { name: 'Delete "Freelance"?' })
    expect(confirm).toHaveTextContent('Used by: Acme resume. It\'s removed from them.')
    expect(confirm).toHaveTextContent('changes the record of what you sent')
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await expectNoA11yViolations()
  })

  it('calls back for each button', () => {
    const { onConfirm, onCancel } = renderConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('leaves out the uses when nothing uses it', async () => {
    render(
      <ConfirmDelete what='"Draft"' uses={[]} effect="" error={null} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('group', { name: 'Delete "Draft"?' })).not.toHaveTextContent('Used by')
    await expectNoA11yViolations()
  })

  it('can name what it lists and say how a sent version is affected', async () => {
    render(
      <ConfirmDelete
        what='"Tech base"'
        uses={[SENT]}
        usesLabel="Copies made from it"
        effect="They're kept."
        locked={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const confirm = screen.getByRole('group', { name: 'Delete "Tech base"?' })
    expect(confirm).toHaveTextContent("Copies made from it: Acme resume. They're kept.")
    expect(confirm).not.toHaveTextContent('record of what you sent')
    await expectNoA11yViolations()
  })

  it('shows an error as an alert', async () => {
    renderConfirm(new ApiError('INTERNAL_ERROR', 'Something went wrong.', null, 500))
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
  })
})
