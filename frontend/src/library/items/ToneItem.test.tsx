import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToneSet } from '../../shared/api/toneSets'
import type { Use } from '../../shared/api/usage'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { errorBody, sentBody, stubApi } from '../../test/stubApi'
import ToneItem from './ToneItem'

const DRAFT: Use = { kind: 'resume', id: 2, name: 'Acme resume', locked: false }
const SENT: Use = { kind: 'resume', id: 4, name: 'Sent resume', locked: true }
const TECH: ToneSet = {
  hidden: false,
  tone_set_id: 3,
  name: 'Tech',
  created_at: '2026-10-01T12:00:00',
  rules: [
    { tone_rule_id: 30, rule_text: 'Lead with tools.' },
    { tone_rule_id: 31, rule_text: 'Use metrics.' },
  ],
  used_by: [],
}
const CHOICE = 'Apply this change to which resumes and cover letters in progress?'

function stub(sets: ToneSet[] = [TECH], extra: Record<string, { status: number; body?: unknown }[]> = {}) {
  return stubApi({ 'GET /api/tone-sets': [{ status: 200, body: sets }], ...extra })
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('ToneItem', () => {
  it('edits, adds, and removes rules in the form, then saves the whole tone at once', async () => {
    const fetchMock = stub([TECH], { 'PUT /api/tone-sets/3': [{ status: 200, body: TECH }] })
    const host = await renderItem(<ToneItem id={3} />)
    // Nothing else uses it, so there's no note and no checklist.
    expect(screen.getByLabelText('Tone name')).not.toHaveAccessibleDescription()
    expect(screen.queryByRole('group', { name: CHOICE })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit "Lead with tools."' }))
    const field = screen.getByLabelText('Edit rule "Lead with tools."')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Name the tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply edit to "Lead with tools."' }))
    expect(host.say).toHaveBeenCalledWith('Changed the rule to "Name the tools.".')
    expect(screen.getByRole('button', { name: 'Edit "Name the tools."' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Remove "Use metrics."' }))
    expect(await screen.findByText('Removed "Use metrics." from Tech rules.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit "Use metrics."' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New rule for Tech'), { target: { value: 'Keep it short.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(host.say).toHaveBeenCalledWith('Added the rule "Keep it short.".')
    expect(screen.getByLabelText('New rule for Tech')).toHaveValue('')

    // Nothing is saved until Save.
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toEqual([])
    fireEvent.change(screen.getByLabelText('Tone name'), { target: { value: 'Engineering' } })
    save()
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalledWith('Saved.', { kind: 'tone', id: 3 }))
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toEqual({
      name: 'Engineering',
      rules: [
        { tone_rule_id: 30, rule_text: 'Name the tools.' },
        { tone_rule_id: null, rule_text: 'Keep it short.' },
      ],
      apply_to: [],
    })
  })

  it('says to type a rule before adding or applying an empty one', async () => {
    stub()
    await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const field = screen.getByLabelText('New rule for Tech')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Type the rule.')
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Short.' } })
    expect(field).toHaveAttribute('aria-invalid', 'false')
  })

  it('cancels a rule edit, going back to its Edit button', async () => {
    stub()
    await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Use metrics."' }))
    fireEvent.change(screen.getByLabelText('Edit rule "Use metrics."'), { target: { value: 'Changed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing "Use metrics."' }))
    expect(screen.queryByLabelText('Edit rule "Use metrics."')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit "Use metrics."' })).toHaveFocus()
  })

  it('asks which ones in progress get the change, and notes a sent version keeps the original', async () => {
    const copy = { ...TECH, tone_set_id: 5, created_at: '2026-11-06T09:30:00', used_by: [DRAFT] }
    const fetchMock = stub([{ ...TECH, used_by: [DRAFT, SENT] }], { 'PUT /api/tone-sets/3': [{ status: 200, body: copy }] })
    const host = await renderItem(<ToneItem id={3} />)
    expect(screen.getByLabelText('Tone name')).toHaveAccessibleDescription(
      'A sent version uses this tone, so saving adds a new one. The sent version keeps this one. Saving changes it only in the ones you check below; the rest keep it as it is.',
    )
    const choice = screen.getByRole('group', { name: CHOICE })
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Resume: Acme resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Use metrics."' }))
    await screen.findByText('Removed "Use metrics." from Tech rules.')
    save()
    // The copy keeps the name, so it's told apart by when it was added.
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        expect.stringMatching(/^Saved as a new version, "Tech, added Nov 6, 2026, .*"\. The ones in progress you checked use it now; everything else keeps "Tech"\.$/),
        { kind: 'tone', id: 5 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toMatchObject({ apply_to: [{ kind: 'resume', id: 2 }] })
  })

  it('names tones that share a name by when each was added', async () => {
    const copy = { ...TECH, tone_set_id: 5, created_at: '2026-11-06T09:30:00' }
    stub([TECH, copy])
    await renderItem(<ToneItem id={5} />)
    expect(screen.getByRole('form', { name: /^Edit "Tech, added Nov 6, 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Delete "Tech, added Nov 6, 2026/ })).toBeInTheDocument()
  })

  it('shows it is saving, keeping focus on Save', async () => {
    stub()
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, init) => (init?.method === 'PUT' ? new Promise<Response>(() => {}) : answer(url, init)))
    const host = await renderItem(<ToneItem id={3} />)
    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
    await expectNoA11yViolations()
    // A second click while saving sends nothing more.
    fireEvent.click(button)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
    expect(host.saved).not.toHaveBeenCalled()
  })

  it('highlights the name when the new one is taken', async () => {
    stub([TECH], {
      'PUT /api/tone-sets/3': [{ status: 409, body: errorBody('DUPLICATE', 'There\'s already a tone named "Teaching".', 'name') }],
    })
    await renderItem(<ToneItem id={3} />)
    fireEvent.change(screen.getByLabelText('Tone name'), { target: { value: 'teaching' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('already a tone named "Teaching"')
    expect(screen.getByLabelText('Tone name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Tone name')).toHaveAccessibleDescription('There\'s already a tone named "Teaching".')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
  })

  it('closes with Cancel, saving nothing', async () => {
    stub()
    const host = await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(host.close).toHaveBeenCalled()
  })

  it('deletes the tone and its rules', async () => {
    stub([TECH], { 'DELETE /api/tone-sets/3': [{ status: 204 }] })
    const host = await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Tech"' }))
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(host.deleted).toHaveBeenCalledWith('Deleted "Tech" and its rules.'))
  })
})
