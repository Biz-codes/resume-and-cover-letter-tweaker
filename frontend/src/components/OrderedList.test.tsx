import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { expectNoA11yViolations } from '../test/axe'
import OrderedList from './OrderedList'

const ITEMS = [
  { id: 1, name: 'Go' },
  { id: 2, name: 'Python' },
  { id: 3, name: 'SQL' },
]

function renderList(onChange = vi.fn(() => Promise.resolve())) {
  render(
    <OrderedList
      label="Back End skills"
      items={ITEMS}
      choices={[...ITEMS, { id: 4, name: 'Rust' }]}
      emptyText="None."
      onChange={onChange}
    />,
  )
  return onChange
}

const button = (name: string) => screen.getByRole('button', { name })

describe('OrderedList', () => {
  it('has no accessibility violations, listed or empty', async () => {
    renderList()
    await expectNoA11yViolations()
    cleanup()
    render(<OrderedList label="AI skills" items={[]} choices={[]} emptyText="None." onChange={vi.fn()} />)
    await expectNoA11yViolations()
  })

  it('moves an item up or down', () => {
    const onChange = renderList()
    fireEvent.click(button('Move SQL up'))
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 2])
    fireEvent.click(button('Move Go down'))
    expect(onChange).toHaveBeenLastCalledWith([2, 1, 3])
  })

  it("keeps the end buttons focusable but does nothing when they're pressed", () => {
    const onChange = renderList()
    // aria-disabled rather than disabled, so a button that just moved its item to the top
    // keeps focus.
    expect(button('Move Go up')).toHaveAttribute('aria-disabled', 'true')
    expect(button('Move SQL down')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button('Move Go up'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('takes an item out and moves focus to the list', async () => {
    const onChange = renderList()
    fireEvent.click(button('Remove Python'))
    expect(onChange).toHaveBeenLastCalledWith([1, 3])
    await vi.waitFor(() => expect(screen.getByRole('group', { name: 'Back End skills' })).toHaveFocus())
  })

  it('offers only unlisted items, adds one at the end, and returns focus to the picker', async () => {
    const onChange = renderList()
    const select = screen.getByLabelText('Add to Back End skills')
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Choose one to add…',
      'Rust',
    ])
    expect(button('Add')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(select, { target: { value: '4' } })
    fireEvent.click(button('Add'))
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4])
    await vi.waitFor(() => expect(select).toHaveFocus())
  })

  it('shows the error when saving fails', async () => {
    renderList(vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'No other category lists Go.', null, 422))))
    fireEvent.click(button('Remove Go'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No other category lists Go.')
    await expectNoA11yViolations()
  })
})
