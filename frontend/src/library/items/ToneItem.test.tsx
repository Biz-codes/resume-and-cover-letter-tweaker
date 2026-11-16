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
  built_in: false,
  created_at: '2026-10-01T12:00:00',
  rules: [
    { tone_rule_id: 30, rule_text: 'Lead with tools.', hidden: false, built_in: false },
    { tone_rule_id: 31, rule_text: 'Use metrics.', hidden: false, built_in: false },
  ],
  used_by: [],
}
const rule = (tone_rule_id: number, rule_text: string, hidden = false): ToneRule => ({
  tone_rule_id,
  rule_text,
  hidden,
  built_in: false,
  tones: [],
  used_by: [],
})
// The library's rules: the tone's two, one more, and a hidden one.
const RULES = [rule(30, 'Lead with tools.'), rule(31, 'Use metrics.'), rule(32, 'Keep it short.'), rule(33, 'Set aside.', true)]
const CHOICE = 'Apply this change to which resumes and cover letters?'

function stub(sets: ToneSet[] = [TECH], extra: Record<string, { status: number; body?: unknown }[]> = {}) {
  return stubApi({ 'GET /api/tone-sets': [{ status: 200, body: sets }], 'GET /api/tone-rules': [{ status: 200, body: RULES }], ...extra })
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
// Saved rules to check and a new rule's field are behind the list's "More options", closed to start.
const openMore = () => fireEvent.click(screen.getByRole('button', { name: /^More options for Tech rules/ }))

describe('ToneItem', () => {
  it('adds saved and new rules, removes one, and saves the whole tone at once', async () => {
    const fetchMock = stub([TECH], { 'PUT /api/tone-sets/3': [{ status: 200, body: TECH }] })
    const host = await renderItem(<ToneItem id={3} />)
    // Nothing else uses it, so there's no note, no checklist, and no earlier name to give.
    expect(screen.getByLabelText('Tone name')).not.toHaveAccessibleDescription()
    expect(screen.queryByRole('group', { name: CHOICE })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Name for the earlier version')).not.toBeInTheDocument()

    // The saved rules it doesn't list are offered as checkboxes, but not a hidden one.
    const more = screen.getByRole('button', { name: 'More options for Tech rules (1)' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    openMore()
    const offeredRules = screen.getByRole('group', { name: 'Choose any to add to Tech rules' })
    expect(within(offeredRules).getAllByRole('checkbox').map((box) => box.closest('label')!.textContent)).toEqual(['Keep it short.'])
    await expectNoA11yViolations()
    fireEvent.click(within(offeredRules).getByRole('checkbox', { name: 'Keep it short.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Tech rules' }))
    expect(await screen.findByText('Added 1 to Tech rules.')).toBeInTheDocument()
    // Nothing more to check, but a new rule can still be written there.
    expect(screen.queryByRole('group', { name: 'Choose any to add to Tech rules' })).not.toBeInTheDocument()

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
    openMore()
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
    openMore()
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const field = screen.getByLabelText('New rule for Tech')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Type the rule.')
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Short.' } })
    expect(field).toHaveAttribute('aria-invalid', 'false')
  })

  it('asks which ones get the change, sent ones too, and names the earlier version the rest keep', async () => {
    const copy = { ...TECH, tone_set_id: 5, used_by: [DRAFT] }
    const fetchMock = stub([{ ...TECH, used_by: [SENT, DRAFT] }], { 'PUT /api/tone-sets/3': [{ status: 200, body: copy }] })
    const host = await renderItem(<ToneItem id={3} />)
    expect(screen.getByLabelText('Tone name')).toHaveAccessibleDescription(
      'Saving changes it only in the ones you check below; the rest keep it as it is.',
    )
    // Tones aren't printed, so a sent one is offered too: after the ones in progress, tagged "sent".
    const group = screen.getByRole('group', { name: CHOICE })
    expect(group).toHaveAccessibleDescription('Unchecked ones keep it as it is. Checking a sent one changes only its tone, not what was sent.')
    expect(within(group).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Resume: Acme resume',
      'Resume: Sent resume sent',
    ])
    expect(within(group).getByText('sent')).toHaveClass('tag')
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

  it('switches a checked sent one, saying the ones checked use it now', async () => {
    const copy = { ...TECH, tone_set_id: 5, used_by: [SENT] }
    const fetchMock = stub([{ ...TECH, used_by: [SENT, DRAFT] }], { 'PUT /api/tone-sets/3': [{ status: 200, body: copy }] })
    const host = await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resume: Sent resume sent' }))
    // The draft isn't checked, so it's still a new tone.
    expect(screen.getByLabelText('Name for the earlier version')).toBeInTheDocument()
    await expectNoA11yViolations()
    save()
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Tech". The ones you checked use it now; everything else keeps "Tech (earlier)".',
        { kind: 'tone', id: 5 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/tone-sets/3')).toMatchObject({ apply_to: [{ kind: 'resume', id: 4 }] })
  })

  it('saves in place, with no earlier name, once every one is checked, sent ones too', async () => {
    stub([{ ...TECH, used_by: [SENT, DRAFT] }])
    await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resume: Acme resume' }))
    expect(screen.getByLabelText('Name for the earlier version')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resume: Sent resume sent' }))
    expect(screen.queryByLabelText('Name for the earlier version')).not.toBeInTheDocument()
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

  it('shows a built-in tone read-only, opening its rules, with no Hide or Delete', async () => {
    const professional: ToneSet = {
      ...TECH,
      tone_set_id: 1,
      name: 'Professional',
      built_in: true,
      rules: [{ tone_rule_id: 5, rule_text: 'Plain, direct sentences.', hidden: false, built_in: true }],
      used_by: [DRAFT],
    }
    stub([professional])
    const host = await renderItem(<ToneItem id={1} />)
    expect(screen.getByText("Built in, so it doesn't change. To vary it, make a copy.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Tone name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Hide|Delete) / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(screen.getByText('Used by (1)')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Plain, direct sentences.' }))
    expect(host.open).toHaveBeenCalledWith({ kind: 'toneRule', id: 5, title: 'Plain, direct sentences.' })
  })

  it('offers built-in rules and your own, in groups', async () => {
    stubApi({
      'GET /api/tone-sets': [{ status: 200, body: [TECH] }],
      'GET /api/tone-rules': [{ status: 200, body: [...RULES, { ...rule(5, 'Plain, direct sentences.'), built_in: true }] }],
    })
    await renderItem(<ToneItem id={3} />)
    openMore()
    expect(screen.getByRole('group', { name: 'Built-in rules' })).toHaveTextContent('Plain, direct sentences.')
    expect(screen.getByRole('group', { name: 'Your rules' })).toHaveTextContent('Keep it short.')
    await expectNoA11yViolations()
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
  it('makes a copy of a built-in tone to build on, then shows the copy', async () => {
    const professional: ToneSet = { ...TECH, tone_set_id: 1, name: 'Professional', built_in: true, used_by: [DRAFT] }
    const copy: ToneSet = { ...TECH, tone_set_id: 9, name: 'Copy of Professional' }
    const fetchMock = stub([professional], { 'POST /api/tone-sets/1/copies': [{ status: 201, body: copy }] })
    const host = await renderItem(<ToneItem id={1} />)
    const button = screen.getByRole('button', { name: 'Make a copy of "Professional"' })
    fireEvent.click(button)
    const name = screen.getByLabelText('Name of the copy')
    await vi.waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveValue('Copy of Professional')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Make copy' }))
    await vi.waitFor(() => expect(host.open).toHaveBeenCalledWith({ kind: 'tone', id: 9, title: 'Copy of Professional' }))
    expect(sentBody(fetchMock, 'POST /api/tone-sets/1/copies')).toEqual({ name: 'Copy of Professional' })
    expect(host.refresh).toHaveBeenCalled()
    expect(host.say).toHaveBeenCalledWith('Made a copy of "Professional" named "Copy of Professional", with the same rules.')
  })

  it("keeps a copy's name form open on a taken name, and cancels back to its button", async () => {
    stub([TECH], { 'POST /api/tone-sets/3/copies': [{ status: 409, body: errorBody('DUPLICATE', 'There\'s already a tone named "Copy of Tech".', 'name') }] })
    const host = await renderItem(<ToneItem id={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Make a copy of "Tech"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There\'s already a tone named "Copy of Tech".')
    expect(screen.getByLabelText('Name of the copy')).toHaveAttribute('aria-invalid', 'true')
    expect(host.open).not.toHaveBeenCalled()
    await expectNoA11yViolations()
    // Its Cancel is told apart from the tone form's by its group.
    const copying = screen.getByRole('group', { name: 'Make a copy of "Tech"' })
    fireEvent.click(within(copying).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Make a copy of "Tech"' })).toHaveFocus())
  })
})
