import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    { tone_rule_id: 30, rule_text: 'Lead with tools and metrics.' },
    { tone_rule_id: 31, rule_text: 'Keep bullets short.' },
  ],
  used_by: [{ kind: 'resume', id: 2, name: 'Acme resume', locked: false }],
}
const TEACHING: ToneSet = { hidden: false, tone_set_id: 4, name: 'Teaching', created_at: '2026-10-01T12:00:00', rules: [], used_by: [] }

function stub(extra: Record<string, Reply[]> = {}, sets = [TEACHING, TECH]) {
  return stubApi({
    'GET /api/tone-sets': [
      { status: 200, body: sets },
      { status: 200, body: sets },
    ],
    ...extra,
  })
}

const techCard = () => openItem('Tech')

describe('ToneSetsPage', () => {
  it('shows each set with its rules in order, and what uses it', async () => {
    stub()
    render(<ToneSetsPage />)
    expect(document.title).toBe('Tones – Resume Tweaker')
    expect(within(await findCard('Tech')).getByText('2 rules')).toBeInTheDocument()
    const card = await techCard()
    expect(card).toHaveAccessibleName('Tech')
    const rules = within(card).getByRole('group', { name: 'Tech rules' })
    expect(within(rules).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Lead with tools and metrics.'),
      expect.stringContaining('Keep bullets short.'),
    ])
    expect(within(card).getByText('Used by (1)')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }))
    expect(within(await openItem('Teaching')).getByText('No rules yet.')).toBeInTheDocument()
  })

  it('adds a set, then a rule, saved with the tone', async () => {
    const fetchMock = stub({
      'POST /api/tone-sets': [{ status: 201, body: { ...TEACHING, tone_set_id: 5, name: 'Writing' } }],
      'PUT /api/tone-sets/4': [{ status: 200, body: TEACHING }],
    })
    render(<ToneSetsPage />)
    fireEvent.change(await screen.findByLabelText('New tone name'), { target: { value: 'Writing' } })
    fireEvent.click(screen.getByText('Add tone'))
    await expectNotice('Added "Writing".')
    const teaching = await openItem('Teaching')
    fireEvent.change(within(teaching).getByLabelText('New rule for Teaching'), { target: { value: 'Name the students.' } })
    fireEvent.click(within(teaching).getByText('Add rule'))
    await vi.waitFor(() => expect(within(teaching).getByRole('status')).toHaveTextContent('Added the rule "Name the students.".'))
    fireEvent.click(within(teaching).getByRole('button', { name: 'Save' }))
    await expectNotice('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/4')).toEqual({
      name: 'Teaching',
      rules: [{ tone_rule_id: null, rule_text: 'Name the students.' }],
      apply_to: [],
    })
  })

  it('reorders and edits rules in the form, then saves them for the resumes checked', async () => {
    const fetchMock = stub({ 'PUT /api/tone-sets/3': [{ status: 200, body: TECH }] })
    render(<ToneSetsPage />)
    const card = await techCard()
    const handle = within(card).getByRole('button', { name: 'Move "Lead with tools and metrics."' })
    fireEvent.click(handle)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.click(handle)
    fireEvent.click(within(card).getByRole('button', { name: 'Edit "Lead with tools and metrics."' }))
    const field = within(card).getByLabelText('Edit rule "Lead with tools and metrics."')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Name the tools.' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Apply edit to "Lead with tools and metrics."' }))
    await vi.waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Changed the rule to "Name the tools.".'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit "Name the tools."' })).toHaveFocus())
    // Nothing is saved until Save.
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
    expect(within(card).getByLabelText('Tone name')).toHaveAccessibleDescription(
      'Saving changes it only in the ones you check below; the rest keep it as it is.',
    )
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Resume: Acme resume' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await expectNotice('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toEqual({
      name: 'Tech',
      rules: [
        { tone_rule_id: 31, rule_text: 'Keep bullets short.' },
        { tone_rule_id: 30, rule_text: 'Name the tools.' },
      ],
      apply_to: [{ kind: 'resume', id: 2 }],
    })
  })

  it('removes a rule in the form', async () => {
    stub()
    render(<ToneSetsPage />)
    const card = await techCard()
    fireEvent.click(within(card).getByRole('button', { name: 'Remove "Keep bullets short."' }))
    expect(await within(card).findByText('Removed "Keep bullets short." from Tech rules.')).toBeInTheDocument()
    expect(within(card).getByText('Rules (1)')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('tells tones with the same name apart by when each was added', async () => {
    const copy = { ...TECH, tone_set_id: 6, created_at: '2026-11-06T09:30:00', used_by: [] }
    stub({}, [TEACHING, TECH, copy])
    render(<ToneSetsPage />)
    expect(await screen.findByRole('heading', { name: /^Tech, added Oct 1, 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Tech, added Nov 6, 2026/ })).toBeInTheDocument()
  })

  it('lists what deleting a set affects, and shows a failed delete', async () => {
    stub({
      'DELETE /api/tone-sets/3': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong. Nothing was changed.') },
        { status: 204 },
      ],
    })
    render(<ToneSetsPage />)
    fireEvent.click(within(await techCard()).getByRole('button', { name: 'Delete "Tech"' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Tech"?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('Used by: Acme resume. They keep going with no tone.')
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Nothing was changed.')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    await expectNotice('Deleted "Tech" and its rules.')
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<ToneSetsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
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

  it('says when there are no tones yet', async () => {
    stub({}, [])
    render(<ToneSetsPage />)
    expect(await screen.findByText('No tones yet.')).toBeInTheDocument()
  })
})
