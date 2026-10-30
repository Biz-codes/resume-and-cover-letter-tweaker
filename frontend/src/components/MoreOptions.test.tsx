import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import MoreOptions from './MoreOptions'

const CHOICES = [
  { id: 'experience:7', name: 'Engineer, Acme', group: 'Role' },
  { id: 'narrative:5', name: 'Engineer with 4 years.', group: 'Narrative content' },
  { id: 'experience:8', name: 'Tutor, Lincoln High', group: 'Role' },
]

function renderOptions(onAdd = vi.fn(() => Promise.resolve(true)), choices = CHOICES) {
  render(<MoreOptions label="Items in Experience" choices={choices} onAdd={onAdd} />)
  return onAdd
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'More options for Items in Experience (3)' }))

describe('MoreOptions', () => {
  it('starts closed, naming its list and how many it offers', async () => {
    renderOptions()
    const toggle = screen.getByRole('button', { name: 'More options for Items in Experience (3)' })
    // Only "More options (3)" shows; which list is for screen readers.
    expect(within(toggle).getByText('for Items in Experience')).toHaveClass('visually-hidden')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('adds the checked ones together, in the order offered, under their headings', async () => {
    const onAdd = renderOptions()
    open()
    const all = screen.getByRole('group', { name: 'Choose any to add to Items in Experience' })
    const roles = within(all).getByRole('group', { name: 'Role' })
    expect(within(roles).getAllByRole('checkbox')).toHaveLength(2)
    const add = screen.getByRole('button', { name: 'Add checked to Items in Experience' })
    expect(add).toHaveTextContent(/^Add$/)
    expect(add).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tutor, Lincoln High' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Engineer, Acme' }))
    fireEvent.click(add)
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledWith(['experience:7', 'experience:8']))
    await vi.waitFor(() => expect(screen.getByRole('checkbox', { name: 'Engineer, Acme' })).not.toBeChecked())
  })

  it('keeps the checks when adding is refused', async () => {
    renderOptions(vi.fn(() => Promise.resolve(false)))
    open()
    const box = screen.getByRole('checkbox', { name: 'Engineer with 4 years.' })
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Items in Experience' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Add checked/ })).toHaveTextContent('Add'))
    expect(box).toBeChecked()
  })

  it('says it is adding', async () => {
    renderOptions(vi.fn(() => new Promise<boolean>(() => {})))
    open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Engineer, Acme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Items in Experience' }))
    // Its name keeps its visible text while adding.
    expect(await screen.findByRole('button', { name: 'Adding checked to Items in Experience' })).toHaveTextContent('Adding…')
    await expectNoA11yViolations()
  })

  it('says when there is nothing more, in the same place', async () => {
    render(<MoreOptions label="Sections" choices={[]} onAdd={vi.fn()} />)
    expect(screen.getByText(/^No more options/)).toHaveTextContent(
      'No more options for Sections: everything listed here is already shown.',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('lists choices without headings on their own', async () => {
    renderOptions(undefined, [{ id: 'skill:1', name: 'React' }] as never)
    fireEvent.click(screen.getByRole('button', { name: 'More options for Items in Experience (1)' }))
    expect(screen.getByRole('checkbox', { name: 'React' })).toBeInTheDocument()
    expect(screen.getAllByRole('group')).toHaveLength(1)
    await expectNoA11yViolations()
  })
})
