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
const announced = () => document.querySelector('[aria-live]') as HTMLElement
const names = () => screen.getAllByRole('listitem').map((row) => row.querySelector('.item-name')?.textContent)

describe('OrderedList', () => {
  it('has no accessibility violations, listed or empty', async () => {
    renderList()
    await expectNoA11yViolations()
    cleanup()
    render(<OrderedList label="AI skills" items={[]} choices={[]} emptyText="None." onChange={vi.fn()} />)
    await expectNoA11yViolations()
  })

  it('reorders by keyboard: Space picks up, arrows move, Space drops', async () => {
    const onChange = renderList()
    const handle = button('Move Go')
    expect(handle).toHaveAccessibleDescription(/press Space to pick up/)
    fireEvent.click(handle)
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    expect(announced()).toHaveTextContent('Picked up Go, position 1 of 3.')
    await expectNoA11yViolations()
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(announced()).toHaveTextContent('Go, position 2 of 3.')
    expect(names()).toEqual(['Python', 'Go', 'SQL'])
    await vi.waitFor(() => expect(button('Move Go')).toHaveFocus())
    fireEvent.keyDown(button('Move Go'), { key: 'ArrowUp' })
    fireEvent.keyDown(button('Move Go'), { key: 'ArrowUp' })
    expect(names()).toEqual(['Go', 'Python', 'SQL'])
    fireEvent.keyDown(button('Move Go'), { key: 'ArrowDown' })
    fireEvent.keyDown(button('Move Go'), { key: 'ArrowDown' })
    fireEvent.click(button('Move Go'))
    expect(onChange).toHaveBeenLastCalledWith([2, 3, 1])
    expect(announced()).toHaveTextContent('Dropped Go, position 3 of 3.')
    expect(button('Move Go')).toHaveAttribute('aria-pressed', 'false')
  })

  it('puts the item back on Escape', () => {
    const onChange = renderList()
    fireEvent.click(button('Move Go'))
    fireEvent.keyDown(button('Move Go'), { key: 'ArrowDown' })
    fireEvent.keyDown(button('Move Go'), { key: 'Escape' })
    expect(names()).toEqual(['Go', 'Python', 'SQL'])
    expect(announced()).toHaveTextContent('Cancelled. Go is back at position 1 of 3.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reorders without dragging: pick up, then Move here', async () => {
    const onChange = renderList()
    fireEvent.click(button('Move SQL'))
    expect(screen.queryByRole('button', { name: 'Remove Go' })).not.toBeInTheDocument()
    expect(button('Cancel move')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(button('Move SQL here, to position 1'))
    expect(onChange).toHaveBeenLastCalledWith([3, 1, 2])
    await vi.waitFor(() => expect(button('Move SQL')).toHaveFocus())
  })

  it('cancels a move from its Cancel button', async () => {
    const onChange = renderList()
    fireEvent.click(button('Move Python'))
    fireEvent.click(button('Cancel move'))
    expect(onChange).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(button('Move Python')).toHaveFocus())
  })

  it('reorders by dragging the handle, past several rows', async () => {
    const onChange = renderList()
    // jsdom has no layout, so give each row a 20px-tall box by where it is in the list now.
    screen.getAllByRole('listitem').forEach((row) => {
      row.getBoundingClientRect = () => {
        const index = [...(row.parentElement?.children ?? [])].indexOf(row)
        return { top: index * 20, height: 20 } as DOMRect
      }
    })
    const handle = button('Move Go')
    fireEvent.pointerDown(handle, { button: 0, clientY: 10, pointerId: 1 })
    // The moves go to the window: the dragged row moves in the page as the list rearranges.
    fireEvent.pointerMove(window, { clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 35, pointerId: 1 })
    expect(names()).toEqual(['Python', 'Go', 'SQL'])
    fireEvent.pointerMove(window, { clientY: 55, pointerId: 1 })
    expect(names()).toEqual(['Python', 'SQL', 'Go'])
    // Mid-drag: no Move here or Cancel buttons, just the highlighted row.
    expect(screen.queryByRole('button', { name: /Move Go here/ })).not.toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    await expectNoA11yViolations()
    fireEvent.pointerUp(window, { pointerId: 1 })
    fireEvent.click(handle)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith([2, 3, 1])
  })

  it('puts a dragged item back when the pointer is cancelled', () => {
    const onChange = renderList()
    const handle = button('Move Go')
    fireEvent.pointerDown(handle, { button: 0, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 60, pointerId: 1 })
    fireEvent.pointerCancel(window, { pointerId: 1 })
    expect(names()).toEqual(['Go', 'Python', 'SQL'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the dropped order in place while it saves', async () => {
    let finish = () => {}
    renderList(vi.fn(() => new Promise<void>((resolve) => (finish = resolve))))
    fireEvent.click(button('Move Go'))
    fireEvent.keyDown(button('Move Go'), { key: 'ArrowDown' })
    fireEvent.click(button('Move Go'))
    expect(names()).toEqual(['Python', 'Go', 'SQL'])
    expect(button('Remove Go')).toBeInTheDocument()
    await expectNoA11yViolations()
    finish()
    // The parent hasn't sent a new list here, so the saved order gives way to the items given.
    await vi.waitFor(() => expect(names()).toEqual(['Go', 'Python', 'SQL']))
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

  it('takes string ids and shows choices under their groups', async () => {
    const onChange = vi.fn(() => Promise.resolve())
    render(
      <OrderedList<string>
        label="Items in Experience"
        items={[{ id: 'experience:1', name: 'Role: Engineer, Acme' }]}
        choices={[
          { id: 'bullet:1', name: 'Bullet: Led the redesign.', group: 'Listed under Experience' },
          { id: 'education:1', name: 'Education: B.A., State', group: 'Education' },
          { id: 'bullet:2', name: 'Bullet: Cut load time.', group: 'Listed under Experience' },
        ]}
        emptyText="None."
        onChange={onChange}
      />,
    )
    const select = screen.getByLabelText('Add to Items in Experience')
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Listed under Experience',
      'Education',
    ])
    await expectNoA11yViolations()
    fireEvent.change(select, { target: { value: 'bullet:2' } })
    fireEvent.click(button('Add'))
    expect(onChange).toHaveBeenLastCalledWith(['experience:1', 'bullet:2'])
  })

  it('shows the error when saving fails', async () => {
    renderList(vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'No other category lists Go.', null, 422))))
    fireEvent.click(button('Remove Go'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No other category lists Go.')
    await expectNoA11yViolations()
  })

  it('can offer its own buttons in place of Remove, hiding them while an item moves', async () => {
    const onEdit = vi.fn()
    render(
      <OrderedList
        label="Tech rules"
        items={ITEMS}
        choices={[]}
        emptyText="None."
        removable={false}
        actions={(item) => (
          <button type="button" onClick={() => onEdit(item.id)}>
            Edit {item.name}
          </button>
        )}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(button('Edit Python'))
    expect(onEdit).toHaveBeenCalledWith(2)
    await expectNoA11yViolations()
    fireEvent.click(button('Move Go'))
    expect(screen.queryByRole('button', { name: 'Edit Python' })).not.toBeInTheDocument()
  })
})
