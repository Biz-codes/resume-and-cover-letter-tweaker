import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToneSet } from '../api/toneSets'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import ToneSetsPage from './ToneSetsPage'

const TECH: ToneSet = {
  tone_set_id: 3,
  name: 'Tech',
  rules: [
    { tone_rule_id: 30, rule_text: 'Lead with tools and metrics.' },
    { tone_rule_id: 31, rule_text: 'Keep bullets short.' },
  ],
  used_by: [{ kind: 'resume', id: 2, name: 'Acme resume', locked: false }],
}
const TEACHING: ToneSet = { tone_set_id: 4, name: 'Teaching', rules: [], used_by: [] }

function stub(extra: Record<string, Reply[]> = {}, sets = [TEACHING, TECH]) {
  return stubApi({
    'GET /api/tone-sets': [
      { status: 200, body: sets },
      { status: 200, body: sets },
    ],
    ...extra,
  })
}

async function techCard() {
  return (await screen.findByRole('heading', { name: 'Tech' })).closest('article') as HTMLElement
}

describe('ToneSetsPage', () => {
  it('shows each set with its rules in order, and what uses it', async () => {
    stub()
    render(<ToneSetsPage />)
    expect(document.title).toBe('Tone sets – Resume Tweaker')
    const card = await techCard()
    const rules = within(card).getByRole('group', { name: 'Tech rules' })
    expect(within(rules).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Lead with tools and metrics.'),
      expect.stringContaining('Keep bullets short.'),
    ])
    // Rules belong to the set, so they're deleted (with a warning), not removed.
    expect(within(rules).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(within(card).getByText('Used by (1)')).toBeInTheDocument()
    expect(screen.getByText('No rules yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('adds a set and a rule', async () => {
    const fetchMock = stub({
      'POST /api/tone-sets': [{ status: 201, body: { ...TEACHING, tone_set_id: 5, name: 'Writing' } }],
      'POST /api/tone-sets/4/rules': [{ status: 201, body: TEACHING }],
    })
    render(<ToneSetsPage />)
    fireEvent.change(await screen.findByLabelText('New tone set name'), { target: { value: 'Writing' } })
    fireEvent.click(screen.getByText('Add tone set'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "Writing".')
    fireEvent.change(screen.getByLabelText('New rule for Teaching'), { target: { value: 'Name the students.' } })
    fireEvent.click(within(screen.getByRole('heading', { name: 'Teaching' }).closest('article') as HTMLElement).getByText('Add rule'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/tone-sets/4/rules')).toEqual({ rule_text: 'Name the students.' }),
    )
  })

  it('reorders rules with the keyboard', async () => {
    const fetchMock = stub({ 'PUT /api/tone-sets/3/rules': [{ status: 200, body: TECH }] })
    render(<ToneSetsPage />)
    const card = await techCard()
    const handle = within(card).getByRole('button', { name: 'Move "Lead with tools and metrics."' })
    fireEvent.click(handle)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.click(handle)
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/tone-sets/3/rules')).toEqual({ tone_rule_ids: [31, 30] }),
    )
  })

  it('edits a rule, then returns focus to its Edit button', async () => {
    const edited = { ...TECH, rules: [{ tone_rule_id: 30, rule_text: 'Name the tools.' }, TECH.rules[1]] }
    const fetchMock = stub({ 'PUT /api/tone-sets/3/rules/30': [{ status: 200, body: edited }] })
    render(<ToneSetsPage />)
    const card = await techCard()
    fireEvent.click(within(card).getByRole('button', { name: 'Edit "Lead with tools and metrics."' }))
    const field = within(card).getByLabelText('Edit rule "Lead with tools and metrics."')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Name the tools.' } })
    fireEvent.click(within(card).getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3/rules/30')).toEqual({ rule_text: 'Name the tools.' })
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit "Lead with tools and metrics."' })).toHaveFocus(),
    )
  })

  it('confirms before deleting a rule', async () => {
    stub({ 'DELETE /api/tone-sets/3/rules/31': [{ status: 200, body: { ...TECH, rules: [TECH.rules[0]] } }] })
    render(<ToneSetsPage />)
    const card = await techCard()
    fireEvent.click(within(card).getByRole('button', { name: 'Delete "Keep bullets short."' }))
    const confirm = screen.getByRole('group', { name: 'Delete the rule "Keep bullets short."?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted the rule "Keep bullets short.".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Tone sets' })).toHaveFocus())
  })

  it('renames a set', async () => {
    const fetchMock = stub({ 'PUT /api/tone-sets/3': [{ status: 200, body: { ...TECH, name: 'Engineering' } }] })
    render(<ToneSetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename "Tech"' }))
    const field = screen.getByLabelText('Tone set name')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toEqual({ name: 'Engineering' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Rename "Tech"' })).toHaveFocus())
  })

  it('lists what deleting a set affects, and shows a failed delete', async () => {
    stub({
      'DELETE /api/tone-sets/3': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong. Nothing was changed.') },
        { status: 204 },
      ],
    })
    render(<ToneSetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "Tech"' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Tech"?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('Used by: Acme resume. They keep going with no tone set.')
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Nothing was changed.')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "Tech" and its rules.')
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

  it('says when there are no tone sets yet', async () => {
    stub({}, [])
    render(<ToneSetsPage />)
    expect(await screen.findByText('No tone sets yet.')).toBeInTheDocument()
  })
})
