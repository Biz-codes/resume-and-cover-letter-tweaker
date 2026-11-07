import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { expectNoA11yViolations } from '../../test/axe'
import ItemParts, { HIDDEN_NOTE, SENT_DELETE_NOTE } from './ItemParts'

function renderParts(
  parts: {
    confirmDelete?: boolean
    hidden?: boolean
    usedBySent?: boolean
    onSetHidden?: (hidden: boolean) => Promise<void>
  } = {},
) {
  const { confirmDelete = true, hidden, usedBySent, onSetHidden } = parts
  render(
    <main>
      <ItemParts
        name='"Shipped it"'
        hidden={hidden}
        usedBySent={usedBySent}
        onSetHidden={onSetHidden}
        form={<label>Title<input /></label>}
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
      </ItemParts>
    </main>,
  )
}

describe('ItemParts', () => {
  it('shows the item’s form, Delete, and what it lists, with no New version', async () => {
    renderParts()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New version/ })).not.toBeInTheDocument()
    // Named for its item, starting with its text (WCAG 2.5.3).
    expect(screen.getByRole('button', { name: 'Delete "Shipped it"' })).toHaveTextContent(/^Delete$/)
    expect(screen.getByText('Used by (2)')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('opens the delete confirm in place of the form, and goes back to Delete', async () => {
    renderParts()
    fireEvent.click(screen.getByRole('button', { name: /^Delete "/ }))
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Delete confirm' })).toBeInTheDocument()
    expect(screen.getByText('Used by (2)')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Cancel delete'))
    expect(screen.getByRole('button', { name: /^Delete "/ })).toHaveFocus()
  })

  it('shows no buttons row when there is nothing but the form', () => {
    renderParts({ confirmDelete: false })
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('hides an item, keeping focus on the button, which becomes Unhide', async () => {
    const onSetHidden = vi.fn(() => Promise.resolve())
    renderParts({ hidden: false, onSetHidden })
    const hide = screen.getByRole('button', { name: 'Hide "Shipped it"' })
    hide.focus()
    fireEvent.click(hide)
    expect(onSetHidden).toHaveBeenCalledWith(true)
    expect(hide).toHaveTextContent('Hiding…')
    expect(hide).toHaveAccessibleName('Hiding… "Shipped it"')
    expect(hide).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
    await vi.waitFor(() => expect(hide).toHaveTextContent('Hide'))
    expect(hide).toHaveFocus()
  })

  it('says a hidden item is hidden, and offers Unhide', async () => {
    const onSetHidden = vi.fn(() => Promise.resolve())
    renderParts({ hidden: true, onSetHidden })
    expect(screen.getByText(HIDDEN_NOTE)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unhide "Shipped it"' }))
    expect(onSetHidden).toHaveBeenCalledWith(false)
    await expectNoA11yViolations()
  })

  it('offers Hide in place of Delete when a sent application uses it', async () => {
    renderParts({ hidden: false, usedBySent: true, onSetHidden: () => Promise.resolve() })
    expect(screen.queryByRole('button', { name: /^Delete "/ })).not.toBeInTheDocument()
    expect(screen.getByText(SENT_DELETE_NOTE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Hide "/ })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows why hiding failed', async () => {
    const onSetHidden = vi.fn(() =>
      Promise.reject(new ApiError('INTERNAL_ERROR', 'Something went wrong. Nothing was changed.', null, 500)),
    )
    renderParts({ hidden: false, onSetHidden })
    fireEvent.click(screen.getByRole('button', { name: /^Hide "/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed.')
    expect(screen.getByRole('button', { name: /^Hide "/ })).toHaveAttribute('aria-disabled', 'false')
  })
})
