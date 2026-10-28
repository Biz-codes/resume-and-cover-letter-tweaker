import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import Collapsible from './Collapsible'

describe('Collapsible', () => {
  it('starts open when it holds something and names its count', async () => {
    render(
      <Collapsible title="Used by" count={2}>
        <p>Acme resume</p>
      </Collapsible>,
    )
    const details = screen.getByText('Used by (2)').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    await expectNoA11yViolations()
  })

  it('starts closed when empty', async () => {
    render(
      <Collapsible title="Skills" count={0}>
        <p>No skills yet.</p>
      </Collapsible>,
    )
    expect((screen.getByText('Skills (0)').closest('details') as HTMLDetailsElement).open).toBe(false)
    await expectNoA11yViolations()
  })
})
