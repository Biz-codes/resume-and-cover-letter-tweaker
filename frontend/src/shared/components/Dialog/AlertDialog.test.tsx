import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../../test/axe'
import { PAGE_HEADING_ID, useFocusLater } from '../../hooks/useFocusLater'
import AlertDialog from './AlertDialog'

// A page that shows a notice when it saves, as the pages do, optionally moving focus as it does.
function Page({ focusTo }: { focusTo?: string }) {
  const [notice, setNotice] = useState<string | null>(null)
  const [shown, setShown] = useState(true)
  const focusLater = useFocusLater()
  return (
    <main>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Postings
      </h2>
      {shown && (
        <button type="button" onClick={() => setNotice('Saved the posting.')}>
          Save
        </button>
      )}
      <button type="button" onClick={() => setNotice('Saved the tracking details.')}>
        Save tracking
      </button>
      <button
        type="button"
        onClick={() => {
          setShown(false)
          setNotice('Deleted "Acme".')
          if (focusTo) focusLater(focusTo)
        }}
      >
        Delete
      </button>
      <button type="button" id="next">
        Next
      </button>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
    </main>
  )
}

const button = (name: string) => screen.getByRole('button', { name })

describe('AlertDialog', () => {
  it('shows nothing without a message', () => {
    render(<Page />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('opens named by its message, with focus on OK, and OK returns focus', async () => {
    render(<Page />)
    button('Save').focus()
    fireEvent.click(button('Save'))
    const alert = screen.getByRole('alertdialog', { name: 'Saved the posting.' })
    expect(alert).toHaveAttribute('open')
    expect(button('OK')).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.click(button('OK'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(button('Save')).toHaveFocus()
  })

  it('closes on Escape, and keeps Tab on OK', () => {
    render(<Page />)
    fireEvent.click(button('Save'))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(button('OK')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('closes on the dialog’s cancel event', () => {
    render(<Page />)
    fireEvent.click(button('Save'))
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('replaces its message with a new one, focusing OK again', () => {
    render(<Page />)
    fireEvent.click(button('Save'))
    fireEvent.click(button('Save tracking'))
    expect(screen.getByRole('alertdialog', { name: 'Saved the tracking details.' })).toBeInTheDocument()
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(button('OK')).toHaveFocus()
  })

  it('moves focus where the change asked for it, once it closes', async () => {
    render(<Page focusTo="next" />)
    fireEvent.click(button('Delete'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(button('OK')).toHaveFocus()
    fireEvent.click(button('OK'))
    expect(button('Next')).toHaveFocus()
  })

  it('moves focus to the page heading when what had it is gone', () => {
    render(<Page />)
    // Save (which had focus) goes away along with its item, and nothing asks for focus.
    fireEvent.click(button('Save'))
    fireEvent.click(button('OK'))
    button('Save').focus()
    fireEvent.click(button('Delete'))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    fireEvent.click(button('OK'))
    expect(screen.getByRole('heading', { name: 'Postings' })).toHaveFocus()
  })
})
