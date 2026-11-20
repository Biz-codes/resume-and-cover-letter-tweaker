import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../../test/axe'
import { categoryLine, lineFit, lineNote } from '../../lineFit'
import LineNote from './LineNote'

const words = (length: number) => 'x'.repeat(length)

describe('lineFit', () => {
  it('wraps at 110 characters, and a bullet at 106, past its marker', () => {
    expect(lineFit(words(110), false)).toEqual({ lines: 1, onLast: 110 })
    expect(lineFit(words(118), false)).toEqual({ lines: 2, onLast: 8 })
    expect(lineFit(words(107), true)).toEqual({ lines: 2, onLast: 1 })
    // Empty text still takes a line, and surrounding spaces don't count.
    expect(lineFit('', false).lines).toBe(1)
    expect(lineFit(`  ${words(106)}  `, true).lines).toBe(1)
  })

  it('says how far a wrapping line runs over', () => {
    expect(lineNote(words(100), false)).toBeNull()
    expect(lineNote(words(118), false)).toBe('2 lines, 8 characters on the second')
    expect(lineNote(words(107), true)).toBe('2 lines, 1 character on the second')
    expect(lineNote(words(221), false)).toBe('3 lines, 1 character on the third')
    expect(lineNote(words(110 * 6 + 1), false)).toBe('7 lines, 1 character on the last')
  })

  it("prints a category's line as its name and skills", () => {
    expect(categoryLine('Front End', ['React', 'TypeScript'])).toBe('Front End: React, TypeScript')
  })
})

describe('LineNote', () => {
  it('shows nothing for text on one line, and says nothing when it first shows', async () => {
    render(<LineNote text="Shipped it" bullet id="lines" what="The bullet" />)
    expect(document.getElementById('lines')).toBeNull()
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('')
    await expectNoA11yViolations()
  })

  it('shows how far wrapping text runs over, and says when the count changes', async () => {
    const { rerender } = render(<LineNote text={words(118)} id="lines" what="Front End" />)
    expect(document.getElementById('lines')).toHaveTextContent('2 lines, 8 characters on the second')
    const live = document.querySelector('[aria-live="polite"]')
    // Not said when it first shows, and not on a change within the same count.
    expect(live).toHaveTextContent('')
    rerender(<LineNote text={words(119)} id="lines" what="Front End" />)
    expect(live).toHaveTextContent('')
    rerender(<LineNote text={words(230)} id="lines" what="Front End" />)
    expect(live).toHaveTextContent('Front End now takes 3 lines.')
    rerender(<LineNote text={words(20)} id="lines" what="Front End" />)
    expect(live).toHaveTextContent('Front End now fits on one line.')
    expect(document.getElementById('lines')).toBeNull()
    await expectNoA11yViolations()
  })

  it('without an id, only says changes', () => {
    const { rerender } = render(<LineNote text={words(20)} what="Front End" />)
    rerender(<LineNote text={words(118)} what="Front End" />)
    expect(screen.queryByText('2 lines, 8 characters on the second')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Front End now takes 2 lines.')
  })
})
