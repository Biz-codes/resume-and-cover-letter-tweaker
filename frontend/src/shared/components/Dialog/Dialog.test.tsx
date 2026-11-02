import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../../test/axe'
import Dialog from './Dialog'

// A page with a button that opens the dialog, as the pages that use it do.
function Page({ titles = ['Edit "Engineer, Acme"'] }: { titles?: string[] }) {
  const [shown, setShown] = useState<number | null>(null)
  return (
    <>
      <button type="button" onClick={() => setShown(0)}>
        Edit
      </button>
      {shown !== null && (
        <Dialog title={titles[shown]} onClose={() => setShown(null)}>
          <p>Used by (2)</p>
          {shown + 1 < titles.length && (
            <button type="button" onClick={() => setShown(shown + 1)}>
              Next item
            </button>
          )}
        </Dialog>
      )}
    </>
  )
}

describe('Dialog', () => {
  it('opens as a modal named by its heading, which takes focus', async () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit "Engineer, Acme"' })
    expect(dialog).toHaveAttribute('open')
    expect(dialog).toContainElement(screen.getByText('Used by (2)'))
    expect(screen.getByRole('heading', { level: 2, name: 'Edit "Engineer, Acme"' })).toHaveFocus()
    await expectNoA11yViolations()
  })

  it('closes with Close, returning focus to the button that opened it', () => {
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Edit' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes with Escape, leaving the closing to the page', () => {
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Edit' })
    opener.focus()
    fireEvent.click(opener)
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('moves focus to the heading again when it shows another item', () => {
    render(<Page titles={['Edit "Engineer, Acme"', 'Edit "Led a team of four"']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
    expect(screen.getByRole('dialog', { name: 'Edit "Led a team of four"' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Edit "Led a team of four"' })).toHaveFocus()
  })
})
