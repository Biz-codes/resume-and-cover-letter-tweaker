import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../shared/api/client'
import { expectNoA11yViolations } from '../test/axe'
import CheckUnchecked from './CheckUnchecked'

const NOUN: [string, string] = ['bullet point', 'bullet points']

describe('CheckUnchecked', () => {
  it('shows nothing when everything is checked', () => {
    const { container } = render(<CheckUnchecked count={0} noun={NOUN} onCheck={vi.fn()} onDone={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says how many are unchecked, checks them, and says what it found', async () => {
    const onDone = vi.fn(() => Promise.resolve())
    render(<CheckUnchecked count={3} noun={NOUN} onCheck={() => Promise.resolve({ checked: 3, flagged: 1 })} onDone={onDone} />)
    expect(screen.getByText("3 bullet points aren't checked against your writing rules.")).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for 3 bullet points' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Checked 3 bullet points: 1 breaks a writing rule, tagged flagged.'))
  })

  it('says when none break a rule, for one', async () => {
    const onDone = vi.fn(() => Promise.resolve())
    render(<CheckUnchecked count={1} noun={NOUN} onCheck={() => Promise.resolve({ checked: 1, flagged: 0 })} onDone={onDone} />)
    expect(screen.getByText("1 bullet point isn't checked against your writing rules.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for 1 bullet point' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Checked 1 bullet point: none break your writing rules.'))
  })

  it('says how many break a rule', async () => {
    const onDone = vi.fn(() => Promise.resolve())
    render(<CheckUnchecked count={4} noun={NOUN} onCheck={() => Promise.resolve({ checked: 4, flagged: 2 })} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for 4 bullet points' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Checked 4 bullet points: 2 break a writing rule, tagged flagged.'))
  })

  it('says it is checking, keeping focus on the button', async () => {
    const onCheck = vi.fn(() => new Promise<never>(() => {}))
    render(<CheckUnchecked count={2} noun={NOUN} onCheck={onCheck} onDone={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Check writing rules for 2 bullet points' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByText('Checking…')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
    // A second press does nothing while it checks.
    fireEvent.click(button)
    expect(onCheck).toHaveBeenCalledTimes(1)
    await expectNoA11yViolations()
  })

  it('shows a failure and says nothing', async () => {
    const onDone = vi.fn()
    render(
      <CheckUnchecked
        count={2}
        noun={NOUN}
        onCheck={() => Promise.reject(new ApiError('AI_UNAVAILABLE', "Claude isn't available.", null, 503))}
        onDone={onDone}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules for 2 bullet points' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Claude isn't available.")
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Check writing rules for 2 bullet points' })).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
  })
})
