import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { WritingFlag } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import { ItemHostContext, type ItemHost } from './itemHost'
import OwnTextFlags from './OwnTextFlags'

const FLAG: WritingFlag = { kind: 'term', rule: 'leverage', quote: 'leveraged', why: 'Filler.' }

function renderFlags(flags: WritingFlag[] | null, onCheck: () => Promise<WritingFlag[] | null>) {
  const host = { say: vi.fn() } as unknown as ItemHost
  render(
    <ItemHostContext.Provider value={host}>
      <OwnTextFlags name='"Leveraged React."' flags={flags} onCheck={onCheck} />
    </ItemHostContext.Provider>,
  )
  return host
}

describe('OwnTextFlags', () => {
  it('shows nothing for text that breaks no rule', () => {
    const { container } = render(
      <ItemHostContext.Provider value={{ say: vi.fn() } as unknown as ItemHost}>
        <OwnTextFlags name='"Shipped it"' flags={[]} onCheck={vi.fn()} />
      </ItemHostContext.Provider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('marks flagged text with each rule it breaks, and checks again', async () => {
    const host = renderFlags([FLAG], () => Promise.resolve([]))
    expect(screen.getByText('Flagged')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Writing rules "Leveraged React." breaks' })).toHaveTextContent('leverage: “leveraged”. Filler.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for "Leveraged React."' }))
    await vi.waitFor(() => expect(host.say).toHaveBeenCalledWith('Checked: it breaks none of your writing rules.'))
  })

  it('says text was not checked, and says what checking finds', async () => {
    const host = renderFlags(null, () => Promise.resolve([FLAG, { ...FLAG, rule: 'synergy' }]))
    expect(screen.getByText('Not checked against your writing rules.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for "Leveraged React."' }))
    await vi.waitFor(() => expect(host.say).toHaveBeenCalledWith('Checked: it breaks 2 writing rules.'))
  })

  it('says it is checking, keeping focus on the button', async () => {
    renderFlags(null, () => new Promise(() => {}))
    const button = screen.getByRole('button', { name: 'Check writing rules for "Leveraged React."' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByText('Checking…')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
    // A second press does nothing while it checks.
    fireEvent.click(button)
    await expectNoA11yViolations()
  })

  it('shows a failed check and says nothing', async () => {
    const host = renderFlags(null, () => Promise.reject(new ApiError('AI_UNAVAILABLE', "Claude isn't available.", null, 503)))
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for "Leveraged React."' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Claude isn't available.")
    expect(host.say).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Check writing rules for "Leveraged React."' })).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
  })
})
