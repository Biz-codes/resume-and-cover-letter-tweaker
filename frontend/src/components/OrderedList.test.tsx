import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
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

describe('OrderedList', () => {
  it('moves an item up or down', () => {
    const onChange = renderList()
    fireEvent.click(screen.getByLabelText('Move SQL up'))
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 2])
    fireEvent.click(screen.getByLabelText('Move Go down'))
    expect(onChange).toHaveBeenLastCalledWith([2, 1, 3])
    expect(screen.getByLabelText('Move Go up')).toBeDisabled()
  })

  it('takes an item out', () => {
    const onChange = renderList()
    fireEvent.click(screen.getByLabelText('Take Python out'))
    expect(onChange).toHaveBeenLastCalledWith([1, 3])
  })

  it('offers only unlisted items and adds one at the end', () => {
    const onChange = renderList()
    const select = screen.getByLabelText('Add to Back End skills')
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Choose one to add…',
      'Rust',
    ])
    fireEvent.change(select, { target: { value: '4' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4])
  })

  it('shows the error when saving fails', async () => {
    renderList(vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'No other category lists Go.', null, 422))))
    fireEvent.click(screen.getByLabelText('Take Go out'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No other category lists Go.')
  })
})
