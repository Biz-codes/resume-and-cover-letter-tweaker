import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import ItemDialog from './ItemDialog'

function renderDialog(parts: { form?: boolean; newVersion?: boolean; confirmDelete?: boolean } = {}) {
  const { form = true, newVersion = true, confirmDelete = true } = parts
  const onClose = vi.fn()
  render(
    <ItemDialog
      title="Engineer, Acme"
      onClose={onClose}
      form={form && <label>Title<input /></label>}
      newVersion={
        newVersion
          ? (back) => (
              <div role="group" aria-label="New version form">
                <button type="button" onClick={back}>
                  Cancel version
                </button>
              </div>
            )
          : undefined
      }
      confirmDelete={
        confirmDelete
          ? (back) => (
              <div role="group" aria-label="Delete confirm">
                <button type="button" onClick={back}>
                  Cancel delete
                </button>
              </div>
            )
          : undefined
      }
    >
      <p>Used by (2)</p>
    </ItemDialog>,
  )
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Engineer, Acme' }) }
}

describe('ItemDialog', () => {
  it('shows the item’s form, New version, Delete, and what it lists', async () => {
    const { dialog } = renderDialog()
    expect(within(dialog).getByLabelText('Title')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'New version' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(within(dialog).getByText('Used by (2)')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('opens New version in place of the form, and goes back to its button', async () => {
    const { dialog } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'New version' }))
    expect(within(dialog).queryByLabelText('Title')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'New version form' })).toBeInTheDocument()
    expect(within(dialog).getByText('Used by (2)')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(within(dialog).getByText('Cancel version'))
    expect(within(dialog).getByLabelText('Title')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'New version' })).toHaveFocus()
  })

  it('opens the delete confirm in place of the form, and goes back to Delete', async () => {
    const { dialog } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(within(dialog).getByRole('group', { name: 'Delete confirm' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(within(dialog).getByText('Cancel delete'))
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('leaves out what an item can’t do, and closes with Close', () => {
    const { dialog, onClose } = renderDialog({ form: false, confirmDelete: false })
    expect(within(dialog).queryByLabelText('Title')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'New version' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows no buttons row when there is nothing but the form', () => {
    const { dialog } = renderDialog({ newVersion: false, confirmDelete: false })
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close'])
  })
})
