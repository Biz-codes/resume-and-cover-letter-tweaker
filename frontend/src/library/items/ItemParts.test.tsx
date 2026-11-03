import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import ItemParts from './ItemParts'

function renderParts(parts: { form?: boolean; newVersion?: boolean; confirmDelete?: boolean } = {}) {
  const { form = true, newVersion = true, confirmDelete = true } = parts
  render(
    <main>
      <ItemParts
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
      </ItemParts>
    </main>,
  )
}

describe('ItemParts', () => {
  it('shows the item’s form, New version, Delete, and what it lists', async () => {
    renderParts()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New version' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByText('Used by (2)')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('opens New version in place of the form, and goes back to its button', async () => {
    renderParts()
    fireEvent.click(screen.getByRole('button', { name: 'New version' }))
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'New version form' })).toBeInTheDocument()
    expect(screen.getByText('Used by (2)')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Cancel version'))
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New version' })).toHaveFocus()
  })

  it('opens the delete confirm in place of the form, and goes back to Delete', async () => {
    renderParts()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('group', { name: 'Delete confirm' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Cancel delete'))
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('leaves out what an item can’t do', () => {
    renderParts({ form: false, confirmDelete: false })
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New version' })).toBeInTheDocument()
  })

  it('shows no buttons row when there is nothing but the form', () => {
    renderParts({ newVersion: false, confirmDelete: false })
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
