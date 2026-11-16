import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToneRule } from '../shared/api/toneRules'
import type { ToneSuggestion } from '../shared/api/toneSets'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi } from '../test/stubApi'
import SuggestTone from './SuggestTone'

const rule = (id: number, text: string, builtIn = false, hidden = false): ToneRule => ({
  tone_rule_id: id,
  rule_text: text,
  hidden,
  built_in: builtIn,
  tones: [],
  used_by: [],
})
const SAVED = [rule(1, 'Keep sentences short.', true), rule(4, 'Name the tools.'), rule(5, 'Set aside.', false, true), rule(6, 'Lead with results.')]
const SUGGESTION: ToneSuggestion = {
  name: 'Startup',
  reason: 'A small team that moves fast.',
  rules: [
    { tone_rule_id: 1, rule_text: 'Keep sentences short.', reason: 'The posting is brief.' },
    { tone_rule_id: null, rule_text: 'Show you work across the stack.', reason: 'It asks for range.' },
  ],
}
const SAVED_TONE = { tone_set_id: 8, name: 'Startup', hidden: false, built_in: false, created_at: '', rules: [], used_by: [] }

function renderSuggest(replies: Record<string, { status: number; body?: unknown }[]> = {}) {
  const fetchMock = stubApi({
    'POST /api/tone-sets/suggested': [{ status: 200, body: SUGGESTION }],
    'GET /api/tone-rules': [{ status: 200, body: SAVED }],
    'POST /api/tone-sets': [{ status: 201, body: SAVED_TONE }],
    ...replies,
  })
  const onSaved = vi.fn(() => Promise.resolve())
  const onCancel = vi.fn()
  render(<SuggestTone kind="resume" postingId={9} onSaved={onSaved} onCancel={onCancel} />)
  return { fetchMock, onSaved, onCancel }
}

const rulesList = () => screen.getByRole('list', { name: 'Startup rules' })
const announced = (text: string) =>
  expect([...document.querySelectorAll('[aria-live="polite"]')].map((region) => region.textContent)).toContain(text)

describe('SuggestTone', () => {
  it('says Claude is writing it, with focus on its heading', async () => {
    stubPendingApi()
    const onCancel = vi.fn()
    render(<SuggestTone kind="cover_letter" postingId={9} onSaved={vi.fn()} onCancel={onCancel} />)
    const heading = screen.getByRole('heading', { name: "Claude's suggested tone" })
    expect(heading).toHaveFocus()
    expect(screen.getByText('Claude is writing a tone for this cover letter. This can take a minute.')).toHaveAttribute('aria-live', 'polite')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows a failure, with Retry', async () => {
    renderSuggest({
      'POST /api/tone-sets/suggested': [
        { status: 503, body: errorBody('AI_UNAVAILABLE', "Claude isn't available.") },
        { status: 200, body: SUGGESTION },
      ],
    })
    expect(await screen.findByRole('alert')).toHaveTextContent("Claude isn't available.")
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByRole('heading', { name: "Claude's suggested tone" })).toHaveFocus()
    expect(await screen.findByRole('textbox', { name: 'Tone name' })).toHaveValue('Startup')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('fills in the tone form, each rule badged with its rationale', async () => {
    renderSuggest()
    const name = await screen.findByRole('textbox', { name: 'Tone name' })
    expect(name).toHaveValue('Startup')
    await vi.waitFor(() => expect(name).toHaveFocus())
    const rows = within(rulesList()).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Keep sentences short.Source: Library')
    expect(rows[1]).toHaveTextContent('Show you work across the stack.Source: Claude')
    // The tone's reason and each rule's, closed to start.
    fireEvent.click(screen.getByRole('button', { name: 'Rationale for "Startup"' }))
    expect(screen.getByText('A small team that moves fast.')).toBeVisible()
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Rationale for "Show you work across the stack."' }))
    expect(screen.getByText('It asks for range.')).toBeVisible()
    // Only new wording can be edited here; a saved rule is edited in its own dialog.
    expect(within(rows[0]).queryByRole('button', { name: /Edit wording/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('edits a new rule in place, and a match for a saved rule becomes that rule', async () => {
    renderSuggest()
    await screen.findByRole('textbox', { name: 'Tone name' })
    const edit = screen.getByRole('button', { name: 'Edit wording of "Show you work across the stack."' })
    fireEvent.click(edit)
    const field = screen.getByRole('textbox', { name: 'Wording' })
    await vi.waitFor(() => expect(field).toHaveFocus())
    await expectNoA11yViolations()
    // Empty, it says so and stays open.
    fireEvent.change(field, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Type the rule, or remove it instead.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Type the rule, or remove it instead.')
    await expectNoA11yViolations()
    // The tone can't have the same rule twice. Typing clears the message first.
    fireEvent.change(field, { target: { value: 'keep sentences  short.' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(field).toHaveAccessibleDescription('This tone already has the rule "keep sentences short.".')
    fireEvent.change(field, { target: { value: 'Show range.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    announced('Changed the rule to "Show range.".')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Edited, it's no longer Claude's wording.
    const row = within(rulesList()).getAllByRole('listitem')[1]
    expect(row).toHaveTextContent('Show range.')
    expect(row).not.toHaveTextContent('Source: Claude')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit wording of "Show range."' })).toHaveFocus())
    // Cancel keeps the wording.
    fireEvent.click(screen.getByRole('button', { name: 'Edit wording of "Show range."' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Wording' }), { target: { value: 'Something else.' } })
    fireEvent.click(within(rulesList()).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit wording of "Show range."' })).toHaveFocus())
    // Unchanged, Done just closes it.
    fireEvent.click(screen.getByRole('button', { name: 'Edit wording of "Show range."' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit wording of "Show range."' })).toHaveFocus())
    // A saved rule's wording is that rule, so it's badged Library, and focus goes to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Edit wording of "Show range."' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Wording' }), { target: { value: 'name the tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    announced('Changed it to your saved rule "Name the tools.".')
    expect(within(rulesList()).getAllByRole('listitem')[1]).toHaveTextContent('Name the tools.Source: Library')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Rules' })).toHaveFocus())
  })

  it('removes rules and adds saved and new ones, then saves the tone', async () => {
    const { fetchMock, onSaved } = renderSuggest()
    await screen.findByRole('textbox', { name: 'Tone name' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Keep sentences short."' }))
    announced('Removed "Keep sentences short.".')
    expect(screen.getByRole('heading', { name: 'Rules' })).toHaveFocus()
    // Saved rules not listed or hidden, under More options, then a new rule's field.
    fireEvent.click(screen.getByRole('button', { name: /More options for Startup rules/ }))
    const choices = screen.getByRole('group', { name: 'Choose any to add to Startup rules' })
    expect(within(choices).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Keep sentences short.',
      'Lead with results.',
      'Name the tools.',
    ])
    await expectNoA11yViolations()
    fireEvent.click(within(choices).getByRole('checkbox', { name: 'Lead with results.' }))
    fireEvent.click(screen.getByRole('button', { name: /Add checked to Startup rules/ }))
    await vi.waitFor(() => announced('Added 1 to Startup rules.'))
    const field = screen.getByRole('textbox', { name: 'New rule for Startup' })
    fireEvent.change(field, { target: { value: 'Mention the mission.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    announced('Added the rule "Mention the mission.".')
    fireEvent.change(field, { target: { value: 'name the  tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    announced('Added your saved rule "Name the tools.".')
    fireEvent.change(field, { target: { value: 'Mention the mission.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    announced('This tone already has the rule "Mention the mission.".')
    fireEvent.change(screen.getByRole('textbox', { name: 'Tone name' }), { target: { value: 'Small team' } })
    expect(screen.getByRole('list', { name: 'Small team rules' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save tone' }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_TONE))
    expect(sentBody(fetchMock, 'POST /api/tone-sets')).toEqual({
      name: 'Small team',
      rules: [{ rule_text: 'Show you work across the stack.' }, { tone_rule_id: 6 }, { rule_text: 'Mention the mission.' }, { tone_rule_id: 4 }],
    })
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows a name that another tone has, at the name', async () => {
    renderSuggest({ 'POST /api/tone-sets': [{ status: 409, body: errorBody('DUPLICATE', 'You already have a tone named "Startup".', 'name') }] })
    const name = await screen.findByRole('textbox', { name: 'Tone name' })
    fireEvent.click(screen.getByRole('button', { name: 'Save tone' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a tone named "Startup".')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('You already have a tone named "Startup".')
    expect(screen.getByRole('button', { name: 'Save tone' })).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
  })

  it('shows a tone with no rules left, keeping focus, and cancels', async () => {
    const { onCancel } = renderSuggest({
      'POST /api/tone-sets/suggested': [{ status: 200, body: { ...SUGGESTION, rules: SUGGESTION.rules.slice(0, 1) } }],
    })
    await screen.findByRole('textbox', { name: 'Tone name' })
    // Removing the last rule leaves focus on the Rules heading, which stays.
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Keep sentences short."' }))
    expect(screen.getByRole('heading', { name: 'Rules' })).toHaveFocus()
    expect(screen.getByText('No rules yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
