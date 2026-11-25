import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { WritingFlag } from '../../api/documents'
import { expectNoA11yViolations } from '../../../test/axe'
import { flagCount } from './flagCount'
import WritingFlags from './WritingFlags'

const drama = { kind: 'pattern' as const, rule: 'em dashes used for drama', quote: '—', why: 'It adds drama.' }
const filler = { kind: 'term' as const, rule: 'leverage', quote: 'leveraged', why: 'Filler.' }

describe('WritingFlags', () => {
  it('lists each rule the text breaks, with the words and why', async () => {
    render(<WritingFlags flags={[drama, filler]} name='"Shipped it"' />)
    const list = screen.getByRole('list', { name: 'Writing rules "Shipped it" breaks' })
    expect(list).toHaveTextContent('em dashes used for drama: “—”. It adds drama.')
    expect(list).toHaveTextContent('leverage: “leveraged”. Filler.')
    await expectNoA11yViolations()
  })

  it('shows nothing when the text breaks no rule', () => {
    const { container } = render(<WritingFlags flags={[]} name="it" />)
    expect(container).toBeEmptyDOMElement()
    render(<WritingFlags name="it" />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('counts the rules for an announcement', () => {
    expect(flagCount([drama])).toBe(' It breaks a writing rule.')
    expect(flagCount([drama, filler])).toBe(' It breaks 2 writing rules.')
    expect(flagCount([])).toBe('')
  })

  it('shows dismissed flags apart, without buttons, when they can\'t change', async () => {
    render(<WritingFlags flags={[{ ...drama, dismissed: true }, filler]} name='"Shipped it"' />)
    expect(screen.getByRole('list', { name: 'Writing rules "Shipped it" breaks' })).not.toHaveTextContent('em dashes')
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed flags (1) on "Shipped it"' }))
    expect(screen.getByRole('list', { name: 'Dismissed flags on "Shipped it"' })).toHaveTextContent('em dashes used for drama')
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dismiss flag/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('dismisses a flag and restores it, moving focus and saying each', async () => {
    // Stands in for the caller, which saves the change and shows the flags as they are then.
    function Host({ say }: { say?: (text: string) => void }) {
      const [flags, setFlags] = useState<WritingFlag[]>([drama, filler])
      return (
        <WritingFlags
          flags={flags}
          name='"Shipped it"'
          say={say}
          onDismiss={async (flag, dismissed) => {
            setFlags((current) => current.map((one) => (one.rule === flag.rule ? { ...one, dismissed } : one)))
          }}
        />
      )
    }
    render(<Host />)
    await expectNoA11yViolations()
    const live = () => document.querySelector('[aria-live="polite"]')?.textContent

    // The first: focus goes to the next flag's Dismiss.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss flag "em dashes used for drama" on "Shipped it"' }))
    await vi.waitFor(() => expect(live()).toBe('Dismissed the flag "em dashes used for drama" on "Shipped it".'))
    expect(screen.getByRole('button', { name: 'Dismiss flag "leverage" on "Shipped it"' })).toHaveFocus()
    // The last: focus goes to "Dismissed flags", and no list of rules is left.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss flag "leverage" on "Shipped it"' }))
    const dismissed = await screen.findByRole('button', { name: 'Dismissed flags (2) on "Shipped it"' })
    await vi.waitFor(() => expect(dismissed).toHaveFocus())
    expect(screen.queryByRole('list', { name: 'Writing rules "Shipped it" breaks' })).not.toBeInTheDocument()
    fireEvent.click(dismissed)
    await expectNoA11yViolations()

    // Restore: focus goes to the flag's Dismiss again.
    fireEvent.click(screen.getByRole('button', { name: 'Restore flag "leverage" on "Shipped it"' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss flag "leverage" on "Shipped it"' })).toHaveFocus())
    expect(live()).toBe('Restored the flag "leverage" on "Shipped it".')
  })

  it('says it through the caller instead of its own live region when given one', async () => {
    const say = vi.fn()
    render(<WritingFlags flags={[drama]} name="it" say={say} onDismiss={() => Promise.resolve()} />)
    expect(document.querySelector('[aria-live]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss flag "em dashes used for drama" on it' }))
    await vi.waitFor(() => expect(say).toHaveBeenCalledWith('Dismissed the flag "em dashes used for drama" on it.'))
  })

  it('shows what went wrong when it can\'t save, keeping the flag', async () => {
    const onDismiss = vi.fn(() => Promise.reject(new ApiError('NOT_FOUND', "That flag isn't there anymore. The text was checked again.", null, 404)))
    render(<WritingFlags flags={[drama]} name="it" onDismiss={onDismiss} />)
    const button = screen.getByRole('button', { name: 'Dismiss flag "em dashes used for drama" on it' })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent("That flag isn't there anymore.")
    expect(button).toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
