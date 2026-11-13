import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
