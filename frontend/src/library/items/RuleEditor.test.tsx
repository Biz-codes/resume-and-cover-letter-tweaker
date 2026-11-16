import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import RuleEditor from './RuleEditor'

function Editor({ onApply }: { onApply: () => void }) {
  const [text, setText] = useState('')
  return <RuleEditor label="New rule for Warm" text={text} applyLabel="Add rule" onText={setText} onApply={onApply} />
}

describe('RuleEditor', () => {
  it('puts the rule in the list, and says when it is empty', async () => {
    const onApply = vi.fn()
    render(<Editor onApply={onApply} />)
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(onApply).not.toHaveBeenCalled()
    const field = screen.getByRole('textbox', { name: 'New rule for Warm' })
    expect(screen.getByRole('alert')).toHaveTextContent('Type the rule.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Type the rule.')
    await expectNoA11yViolations()
    // Typing clears the message.
    fireEvent.change(field, { target: { value: 'Be warm.' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
