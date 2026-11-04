import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import ApplyChoice from './ApplyChoice'

const DRAFT = { kind: 'resume' as const, id: 3, name: 'Draft resume', locked: false }
const LETTER = { kind: 'cover_letter' as const, id: 3, name: 'Draft letter', locked: false }

describe('ApplyChoice', () => {
  it('offers each one in progress, none checked, and says what unchecked ones keep', async () => {
    render(<ApplyChoice uses={[DRAFT, LETTER]} applyTo={[]} onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Apply this change to which resumes and cover letters in progress?' })
    expect(group).toHaveAccessibleDescription('Unchecked ones keep it as it is.')
    expect(screen.getByRole('checkbox', { name: 'Resume: Draft resume' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Cover letter: Draft letter' })).not.toBeChecked()
    await expectNoA11yViolations()
  })

  it('reports the checked ones in their order, telling a resume and a letter with one id apart', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ApplyChoice uses={[DRAFT, LETTER]} applyTo={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cover letter: Draft letter' }))
    expect(onChange).toHaveBeenLastCalledWith([LETTER])
    rerender(<ApplyChoice uses={[DRAFT, LETTER]} applyTo={[LETTER]} onChange={onChange} />)
    expect(screen.getByRole('checkbox', { name: 'Resume: Draft resume' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resume: Draft resume' }))
    expect(onChange).toHaveBeenLastCalledWith([DRAFT, LETTER])
    rerender(<ApplyChoice uses={[DRAFT, LETTER]} applyTo={[DRAFT, LETTER]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cover letter: Draft letter' }))
    expect(onChange).toHaveBeenLastCalledWith([DRAFT])
  })
})
