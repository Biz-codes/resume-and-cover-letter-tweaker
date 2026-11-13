import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToneRule } from '../shared/api/toneRules'
import type { ToneSet } from '../shared/api/toneSets'
import { expectNoA11yViolations } from '../test/axe'
import { findCard, openItem } from '../test/openCard'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import ToneSetsPage from './ToneSetsPage'
import { expectNotice } from '../test/notice'

const TECH: ToneSet = {
  hidden: false,
  tone_set_id: 3,
  name: 'Tech',
  created_at: '2026-10-01T12:00:00',
  rules: [
    { tone_rule_id: 30, rule_text: 'Lead with tools and metrics.', hidden: false },
    { tone_rule_id: 31, rule_text: 'Keep bullets short.', hidden: false },
  ],
  used_by: [{ kind: 'resume', id: 2, name: 'Acme resume', locked: false }],
}
const TEACHING: ToneSet = { hidden: false, tone_set_id: 4, name: 'Teaching', created_at: '2026-10-01T12:00:00', rules: [], used_by: [] }
const rule = (tone_rule_id: number, rule_text: string, tones: string[] = [], hidden = false): ToneRule => ({
  tone_rule_id,
  rule_text,
  hidden,
  tones: tones.map((name, index) => ({ tone_set_id: index + 3, name, used_by: [] })),
  used_by: [],
})
const RULES = [rule(30, 'Lead with tools and metrics.', ['Tech']), rule(31, 'Keep bullets short.', ['Tech']), rule(32, 'Name the students.')]

function stub(extra: Record<string, Reply[]> = {}, sets = [TEACHING, TECH], rules = RULES) {
  return stubApi({
    'GET /api/tone-sets': [
      { status: 200, body: sets },
      { status: 200, body: sets },
    ],
    'GET /api/tone-rules': [
      { status: 200, body: rules },
      { status: 200, body: rules },
    ],
    ...extra,
  })
}

describe('ToneSetsPage', () => {
  it('shows tones and tone rules in their own groups', async () => {
    stub()
    render(<ToneSetsPage />)
    expect(document.title).toBe('Tones – Resume Tweaker')
    expect(within(await findCard('Tech')).getByText('2 rules')).toBeInTheDocument()
    expect(within(await findCard('Teaching')).getByText('0 rules')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'All tones', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'All tone rules', level: 3 })).toBeInTheDocument()
    // Each rule says which tones list it.
    expect(within(await findCard('Keep bullets short.')).getByText('In Tech')).toBeInTheDocument()
    expect(within(await findCard('Name the students.')).getByText('In no tone yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("opens a tone's dialog, with its rules in order", async () => {
    stub()
    render(<ToneSetsPage />)
    const card = await openItem('Tech')
    const rules = within(card).getByRole('group', { name: 'Tech rules' })
    expect(within(rules).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Lead with tools and metrics.'),
      expect.stringContaining('Keep bullets short.'),
    ])
    expect(within(card).getByText('Used by (1)')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("opens a rule's dialog", async () => {
    stub()
    render(<ToneSetsPage />)
    fireEvent.click(within(await findCard('Keep bullets short.')).getByRole('button', { name: 'View and Edit "Keep bullets short."' }))
    expect(await screen.findByRole('dialog', { name: 'Keep bullets short.' })).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByLabelText('Rule')).toHaveValue('Keep bullets short.'))
    await expectNoA11yViolations()
  })

  it('adds a tone and a rule', async () => {
    const fetchMock = stub({
      'POST /api/tone-sets': [{ status: 201, body: { ...TEACHING, tone_set_id: 5, name: 'Writing' } }],
      'POST /api/tone-rules': [
        { status: 201, body: rule(33, 'Use plain words.') },
        { status: 201, body: RULES[1] },
      ],
    })
    render(<ToneSetsPage />)
    fireEvent.change(await screen.findByLabelText('New tone name'), { target: { value: 'Writing' } })
    fireEvent.click(screen.getByText('Add tone'))
    await expectNotice('Added "Writing".')
    fireEvent.change(screen.getByLabelText('New tone rule'), { target: { value: 'Use plain words.' } })
    fireEvent.click(screen.getByText('Add rule'))
    await expectNotice('Added "Use plain words.".')
    expect(sentBody(fetchMock, 'POST /api/tone-rules')).toEqual({ rule_text: 'Use plain words.' })
  })

  it('says when a new rule is one already saved', async () => {
    stub({ 'POST /api/tone-rules': [{ status: 201, body: RULES[1] }] })
    render(<ToneSetsPage />)
    fireEvent.change(await screen.findByLabelText('New tone rule'), { target: { value: 'keep bullets SHORT.' } })
    fireEvent.click(screen.getByText('Add rule'))
    await expectNotice('You already have the rule "Keep bullets short.".')
  })

  it('puts hidden tones and rules in Hidden', async () => {
    stub({}, [TEACHING, { ...TECH, hidden: true }], [...RULES, rule(34, 'Set aside.', [], true)])
    render(<ToneSetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hidden (2)' }))
    expect(screen.getByRole('button', { name: 'Unhide "Tech"' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unhide "Set aside."' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<ToneSetsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the lists fail to load', async () => {
    stub({
      'GET /api/tone-sets': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [TECH] },
      ],
    })
    render(<ToneSetsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByRole('heading', { name: 'Tech' })).toBeInTheDocument()
  })

  it('says when there are no tones or rules yet', async () => {
    stub({}, [], [])
    render(<ToneSetsPage />)
    expect(await screen.findByText('No tones yet.')).toBeInTheDocument()
    expect(screen.getByText('No tone rules yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
