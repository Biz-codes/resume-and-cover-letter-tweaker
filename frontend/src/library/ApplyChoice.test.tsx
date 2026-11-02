import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import ApplyChoice from './ApplyChoice'

const DRAFT = { kind: 'resume' as const, id: 3, name: 'Draft resume', locked: false }

describe('ApplyChoice', () => {
  it('names what is in progress, defaults to No, and reports a change', async () => {
    const onChange = vi.fn()
    render(<ApplyChoice uses={[DRAFT]} apply={false} onChange={onChange} />)
    expect(screen.getByRole('group', { name: /Used by: Draft resume/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /No, save it as a new version/ })).toBeChecked()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('radio', { name: 'Yes, change it for them too.' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
