import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToneSet } from '../../shared/api/toneSets'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import ToneItem from './ToneItem'

const TECH: ToneSet = { tone_set_id: 3, name: 'Tech', rules: [{ tone_rule_id: 30, rule_text: 'Lead with tools.' }], used_by: [] }

describe('ToneItem', () => {
  it('saves a rule in place and says so in the dialog', async () => {
    stubApi({
      'GET /api/tone-sets': [{ status: 200, body: [TECH] }],
      'PUT /api/tone-sets/3/rules/30': [{ status: 200, body: TECH }],
    })
    const host = await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Lead with tools."' }))
    const field = screen.getByLabelText('Edit rule "Lead with tools."')
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Name the tools.' } })
    fireEvent.click(within(field.closest('form') as HTMLElement).getByText('Save'))
    await vi.waitFor(() => expect(host.say).toHaveBeenCalledWith('Saved the rule "Name the tools.".'))
    expect(host.saved).not.toHaveBeenCalled()
  })
})
