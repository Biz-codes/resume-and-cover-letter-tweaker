import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { splitTones, type ToneRule } from '../../shared/api/toneRules'
import type { Use } from '../../shared/api/usage'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { errorBody, sentBody, stubApi } from '../../test/stubApi'
import ToneRuleItem from './ToneRuleItem'

const DRAFT: Use = { kind: 'resume', id: 2, name: 'Acme resume', locked: false }
const OTHER: Use = { kind: 'cover_letter', id: 6, name: 'Acme letter', locked: false }
const SENT: Use = { kind: 'resume', id: 4, name: 'Sent resume', locked: true }
const RULE: ToneRule = {
  tone_rule_id: 30,
  rule_text: 'Lead with tools.',
  hidden: false,
  tones: [{ tone_set_id: 3, name: 'Tech', used_by: [] }],
  used_by: [],
}
// Used through two tones: Tech by a sent one and a draft, Short by another draft.
const SHARED: ToneRule = {
  ...RULE,
  tones: [
    { tone_set_id: 3, name: 'Tech', used_by: [SENT, DRAFT] },
    { tone_set_id: 5, name: 'Short', used_by: [OTHER] },
  ],
  used_by: [SENT, DRAFT, OTHER],
}
const CHOICE = 'Apply this change to which resumes and cover letters in progress?'

function stub(rule: ToneRule = RULE, extra: Record<string, { status: number; body?: unknown }[]> = {}) {
  return stubApi({ 'GET /api/tone-rules': [{ status: 200, body: [rule] }], ...extra })
}

describe('splitTones', () => {
  it('names the tones used by both picked ones and others', () => {
    expect(splitTones(SHARED, []).map((tone) => tone.name)).toEqual([])
    expect(splitTones(SHARED, [DRAFT]).map((tone) => tone.name)).toEqual(['Tech'])
    expect(splitTones(SHARED, [DRAFT, OTHER]).map((tone) => tone.name)).toEqual(['Tech'])
    expect(splitTones(SHARED, [OTHER]).map((tone) => tone.name)).toEqual([])
  })
})

describe('ToneRuleItem', () => {
  it('edits the rule in place when nothing else uses it, listing its tones', async () => {
    const fetchMock = stub(RULE, { 'PUT /api/tone-rules/30': [{ status: 200, body: { ...RULE, rule_text: 'Name the tools.' } }] })
    const host = await renderItem(<ToneRuleItem id={30} />)
    expect(screen.getByText('Tones (1)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tech' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'Name the tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalledWith('Saved.', { kind: 'toneRule', id: 30 }))
    expect(sentBody(fetchMock, 'PUT /api/tone-rules/30')).toEqual({ rule_text: 'Name the tools.', apply_to: [], earlier_names: {} })
  })

  it('opens a tone that lists it in the same dialog', async () => {
    stub()
    const host = await renderItem(<ToneRuleItem id={30} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tech' }))
    expect(host.open).toHaveBeenCalledWith({ kind: 'tone', id: 3, title: 'Tech' })
  })

  it('asks for the earlier name of each tone saving splits, and says what was kept', async () => {
    const saved = { ...SHARED, tone_rule_id: 40, rule_text: 'Name the tools.' }
    const fetchMock = stub(SHARED, { 'PUT /api/tone-rules/30': [{ status: 200, body: saved }] })
    const host = await renderItem(<ToneRuleItem id={30} />)
    expect(screen.getByLabelText('Rule')).toHaveAccessibleDescription(/A sent version's tone lists this rule, so saving adds a new rule\./)
    // Nothing picked yet, so no tone is split.
    expect(screen.queryByRole('group', { name: 'Names for the earlier versions' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('group', { name: CHOICE })).getByRole('checkbox', { name: 'Resume: Acme resume' }))
    expect(host.say).toHaveBeenLastCalledWith('Saving also adds new versions of Tech. Name the earlier versions below.')
    const names = screen.getByRole('group', { name: 'Names for the earlier versions' })
    const tech = within(names).getByLabelText('Earlier version of Tech')
    expect(tech).toHaveValue('Tech (earlier)')
    expect(within(names).queryByLabelText('Earlier version of Short')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(tech, { target: { value: 'Tech (sent)' } })
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'Name the tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Name the tools.". The ones in progress you checked use it now; everything else keeps "Lead with tools.". Earlier versions kept as "Tech (sent)".',
        { kind: 'toneRule', id: 40 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/tone-rules/30')).toEqual({
      rule_text: 'Name the tools.',
      apply_to: [{ kind: 'resume', id: 2 }],
      earlier_names: { 3: 'Tech (sent)' },
    })
  })

  it('shows an error from saving', async () => {
    stub(RULE, {
      'PUT /api/tone-rules/30': [{ status: 409, body: errorBody('DUPLICATE', "There's already a rule with this text.", 'rule_text') }],
    })
    await renderItem(<ToneRuleItem id={30} />)
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'Use metrics.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("There's already a rule with this text.")
    await expectNoA11yViolations()
  })

  it('hides it, keeping the dialog open', async () => {
    stubApi({
      'GET /api/tone-rules': [
        { status: 200, body: [RULE] },
        { status: 200, body: [{ ...RULE, hidden: true }] },
      ],
      'PUT /api/tone-rules/30/hidden': [{ status: 200, body: { ...RULE, hidden: true } }],
    })
    const host = await renderItem(<ToneRuleItem id={30} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide "Lead with tools."' }))
    expect(await screen.findByRole('button', { name: 'Unhide "Lead with tools."' })).toBeInTheDocument()
    expect(host.refresh).toHaveBeenCalled()
  })

  it('deletes it, saying what it affects', async () => {
    stub({ ...RULE, used_by: [DRAFT] }, { 'DELETE /api/tone-rules/30': [{ status: 204 }] })
    const host = await renderItem(<ToneRuleItem id={30} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Lead with tools."' }))
    expect(screen.getByText(/It's taken out of their tones, and out of every other tone that lists it\./)).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(host.deleted).toHaveBeenCalledWith('Deleted "Lead with tools.".'))
  })

  it('offers only Hide when a sent version uses it', async () => {
    stub({ ...RULE, used_by: [SENT], tones: [{ tone_set_id: 3, name: 'Tech', used_by: [SENT] }] })
    await renderItem(<ToneRuleItem id={30} />)
    expect(screen.queryByRole('button', { name: 'Delete "Lead with tools."' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide "Lead with tools."' })).toBeInTheDocument()
  })
})
