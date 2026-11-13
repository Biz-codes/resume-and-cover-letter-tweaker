import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToneRule } from '../../shared/api/toneRules'
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
    { tone_rule_id: 30, rule_text: 'Lead with tools.', hidden: false },
    { tone_rule_id: 31, rule_text: 'Use metrics.', hidden: false },
  ],
  used_by: [],
}
const rule = (tone_rule_id: number, rule_text: string, hidden = false): ToneRule => ({
  tone_rule_id,
  rule_text,
  hidden,
  tones: [],
  used_by: [],
})
// The library's rules: the tone's two, one more, and a hidden one.
const RULES = [rule(30, 'Lead with tools.'), rule(31, 'Use metrics.'), rule(32, 'Keep it short.'), rule(33, 'Set aside.', true)]
const CHOICE = 'Apply this change to which resumes and cover letters in progress?'

function stub(sets: ToneSet[] = [TECH], extra: Record<string, { status: number; body?: unknown }[]> = {}) {
  return stubApi({ 'GET /api/tone-sets': [{ status: 200, body: sets }], 'GET /api/tone-rules': [{ status: 200, body: RULES }], ...extra })
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('ToneItem', () => {
  it('adds saved and new rules, removes one, and saves the whole tone at once', async () => {
    const fetchMock = stub([TECH], { 'PUT /api/tone-sets/3': [{ status: 200, body: TECH }] })
    const host = await renderItem(<ToneItem id={3} />)
    // Nothing else uses it, so there's no note, no checklist, and no earlier name to give.
    expect(screen.getByLabelText('Tone name')).not.toHaveAccessibleDescription()
    expect(screen.queryByRole('group', { name: CHOICE })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Name for the earlier version')).not.toBeInTheDocument()

    // The saved rules it doesn't list are offered, but not a hidden one.
    const picker = screen.getByRole('combobox', { name: /Tech rules/ })
    const options = within(picker).getAllByRole('option').map((option) => option.textContent)
    expect(options).toContain('Keep it short.')
    expect(options).not.toContain('Set aside.')
    expect(options).not.toContain('Lead with tools.')
    await expectNoA11yViolations()
    fireEvent.change(picker, { target: { value: '32' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Tech rules' }))
    expect(await screen.findByText(/Added "Keep it short\." to Tech rules/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove "Use metrics."' }))
    expect(await screen.findByText('Removed "Use metrics." from Tech rules.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New rule for Tech'), { target: { value: 'Name the stack.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(host.say).toHaveBeenCalledWith('Added the rule "Name the stack.".')
    expect(screen.getByLabelText('New rule for Tech')).toHaveValue('')

    // Nothing is saved until Save.
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toEqual([])
    fireEvent.change(screen.getByLabelText('Tone name'), { target: { value: 'Engineering' } })
    save()
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalledWith('Saved.', { kind: 'tone', id: 3 }))
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toEqual({
      name: 'Engineering',
      rules: [{ tone_rule_id: 30 }, { tone_rule_id: 32 }, { rule_text: 'Name the stack.' }],
      apply_to: [],
      earlier_name: null,
    })
  })

  it('uses a saved rule with the same text, and says when the tone already has it', async () => {
    const fetchMock = stub([TECH], { 'PUT /api/tone-sets/3': [{ status: 200, body: TECH }] })
    const host = await renderItem(<ToneItem id={3} />)
    const field = screen.getByLabelText('New rule for Tech')
    fireEvent.change(field, { target: { value: '  keep IT   short. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(host.say).toHaveBeenCalledWith('Added your saved rule "Keep it short.".')
    fireEvent.change(field, { target: { value: 'use metrics.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(host.say).toHaveBeenLastCalledWith('This tone already has the rule "use metrics.".')
    save()
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalled())
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toMatchObject({
      rules: [{ tone_rule_id: 30 }, { tone_rule_id: 31 }, { tone_rule_id: 32 }],
    })
  })

  it('says to type a rule before adding an empty one', async () => {
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

  it('asks which ones in progress get the change, and names the earlier version the rest keep', async () => {
    const copy = { ...TECH, tone_set_id: 5, used_by: [DRAFT] }
    const fetchMock = stub([{ ...TECH, used_by: [DRAFT, SENT] }], { 'PUT /api/tone-sets/3': [{ status: 200, body: copy }] })
    const host = await renderItem(<ToneItem id={3} />)
    expect(screen.getByLabelText('Tone name')).toHaveAccessibleDescription(
      'A sent version uses this tone, so saving adds a new one. The sent version keeps this one. Saving changes it only in the ones you check below; the rest keep it as it is.',
    )
    const earlier = screen.getByLabelText('Name for the earlier version')
    expect(earlier).toHaveValue('Tech (earlier)')
    expect(earlier).toHaveAccessibleDescription('Saving adds a new tone named “Tech”. The ones that keep this tone use it under this name.')
    await expectNoA11yViolations()
    fireEvent.click(within(screen.getByRole('group', { name: CHOICE })).getByRole('checkbox', { name: 'Resume: Acme resume' }))
    fireEvent.change(earlier, { target: { value: 'Tech 2025' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Use metrics."' }))
    await screen.findByText('Removed "Use metrics." from Tech rules.')
    save()
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Tech". The ones in progress you checked use it now; everything else keeps "Tech 2025".',
        { kind: 'tone', id: 5 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toMatchObject({ apply_to: [{ kind: 'resume', id: 2 }], earlier_name: 'Tech 2025' })
  })

  it('asks for no earlier name once every one in progress is checked', async () => {
    stub([{ ...TECH, used_by: [DRAFT] }])
    const host = await renderItem(<ToneItem id={3} />)
    expect(screen.getByLabelText('Name for the earlier version')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resume: Acme resume' }))
    expect(screen.queryByLabelText('Name for the earlier version')).not.toBeInTheDocument()
    // The field going away, and coming back, is said.
    expect(host.say).toHaveBeenLastCalledWith('Saving changes this tone where it is, so no earlier name is needed.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resume: Acme resume' }))
    expect(host.say).toHaveBeenLastCalledWith('Saving adds a new tone. Name the earlier version below.')
  })

  it('highlights the earlier name when it is taken', async () => {
    stub([{ ...TECH, used_by: [SENT] }], {
      'PUT /api/tone-sets/3': [{ status: 409, body: errorBody('DUPLICATE', 'There\'s already a tone named "Teaching".', 'earlier_name') }],
    })
    await renderItem(<ToneItem id={3} />)
    fireEvent.change(screen.getByLabelText('Name for the earlier version'), { target: { value: 'Teaching' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('already a tone named "Teaching"')
    const field = screen.getByLabelText('Name for the earlier version')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/already a tone named "Teaching"/)
    expect(screen.getByLabelText('Tone name')).toHaveAttribute('aria-invalid', 'false')
    await expectNoA11yViolations()
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

  it('deletes the tone, keeping its rules in the library', async () => {
    stub([{ ...TECH, used_by: [DRAFT] }], { 'DELETE /api/tone-sets/3': [{ status: 204 }] })
    const host = await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Tech"' }))
    expect(screen.getByText(/Its rules stay in your library\./)).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(host.deleted).toHaveBeenCalledWith('Deleted "Tech". Its rules stay in your library.'))
  })
})
