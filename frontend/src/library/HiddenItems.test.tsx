import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../shared/api/client'
import { expectNoA11yViolations } from '../test/axe'
import HiddenItems, { UnhideButton } from './HiddenItems'

describe('HiddenItems', () => {
  it('shows nothing when nothing is hidden', () => {
    render(
      <main>
        <HiddenItems count={0}>
          <p>Shipped it</p>
        </HiddenItems>
      </main>,
    )
    expect(screen.queryByRole('button', { name: /^Hidden/ })).not.toBeInTheDocument()
  })

  it('starts closed under "Hidden (n)", a heading, and opens to its cards', async () => {
    render(
      <main>
        <HiddenItems count={2}>
          <p>Shipped it</p>
        </HiddenItems>
      </main>,
    )
    const toggle = screen.getByRole('button', { name: 'Hidden (2)' })
    expect(screen.getByRole('heading', { level: 3, name: 'Hidden (2)' })).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Shipped it')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(toggle)
    expect(screen.getByText('Shipped it')).toBeInTheDocument()
  })
})

describe('UnhideButton', () => {
  it('names its item and says it’s saving, keeping focus', async () => {
    const onUnhide = vi.fn(() => new Promise<void>(() => {}))
    render(<UnhideButton name="Shipped it" onUnhide={onUnhide} />)
    const button = screen.getByRole('button', { name: 'Unhide "Shipped it"' })
    button.focus()
    fireEvent.click(button)
    expect(onUnhide).toHaveBeenCalledTimes(1)
    expect(button).toHaveTextContent('Unhiding…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onUnhide).toHaveBeenCalledTimes(1)
    await expectNoA11yViolations()
  })

  it('shows why it failed, and can be tried again', async () => {
    const onUnhide = vi.fn(() => Promise.reject(new ApiError('INTERNAL_ERROR', 'Something went wrong. Nothing was changed.', null, 500)))
    render(<UnhideButton name="Shipped it" onUnhide={onUnhide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unhide "Shipped it"' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed.')
    expect(screen.getByRole('button', { name: 'Unhide "Shipped it"' })).toHaveTextContent('Unhide')
  })
})
