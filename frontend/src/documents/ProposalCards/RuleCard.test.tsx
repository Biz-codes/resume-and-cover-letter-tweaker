import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { RuleProposal } from '../../shared/api/chat'
import type { Use } from '../../shared/api/usage'
import { expectNoA11yViolations } from '../../test/axe'
import { describe as titleOf } from './describe'
import RuleCard from './RuleCard'

const rule = (more: Partial<RuleProposal> = {}): RuleProposal => ({
  kind: 'rule',
  id: 'toolu_1',
  action: 'add',
  target: 'tone',
  rule_id: 0,
  new_text: 'Lead with results.',
  reason: 'You asked for results first.',
  before: '',
  tone_set_id: 5,
  tone_name: 'Tech',
  built_in: false,
  state: 'pending',
  ...more,
})

const OTHER: Use = { kind: 'cover_letter', id: 9, name: 'Acme letter', locked: false }

function renderCard(proposal: RuleProposal, uses: Use[] = [], readOnly = false) {
  const onApply = vi.fn(() => Promise.resolve())
  const onState = vi.fn(() => Promise.resolve())
  const onReply = vi.fn()
  const title = titleOf(proposal, [])
  render(
    <ul>
      <li>
        <RuleCard
          proposal={proposal}
          title={title}
          idBase="card-1"
          singular="resume"
          readOnly={readOnly}
          uses={uses}
          onApply={onApply}
          onState={onState}
          onReply={onReply}
        />
      </li>
    </ul>,
  )
  return { onApply, onState, onReply, title }
}

describe('RuleCard', () => {
  it('names what each rule change does', () => {
    expect(titleOf(rule({ target: 'banned', new_text: 'streamlined' }), [])).toBe('Ban "streamlined"')
    expect(titleOf(rule({ target: 'banned', action: 'remove', before: 'synergy' }), [])).toBe('Stop banning "synergy"')
    expect(titleOf(rule(), [])).toBe('Add "Lead with results." to the "Tech" tone')
    expect(titleOf(rule({ action: 'reword', before: 'Name the tools.' }), [])).toBe('Reword "Name the tools." in the "Tech" tone')
    expect(titleOf(rule({ action: 'remove', before: 'Keep it short.' }), [])).toBe('Remove "Keep it short." from the "Tech" tone')
  })

  it('bans a word right away, since it reaches no one else', async () => {
    const { onApply } = renderCard(rule({ target: 'banned', new_text: 'streamlined', tone_set_id: 0, tone_name: '' }))
    expect(screen.getByText('Banned')).toBeInTheDocument()
    expect(screen.getByText('streamlined')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Ban "streamlined"' }))
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith({ apply_to: [], earlier_name: null, copy_name: null }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('changes a tone only this one uses right away', async () => {
    const { onApply } = renderCard(rule({ action: 'reword', before: 'Name the tools.', new_text: 'Name the tools and versions.' }))
    expect(screen.getByText('Before').nextElementSibling).toHaveTextContent('Name the tools.')
    expect(screen.getByText('After').nextElementSibling).toHaveTextContent('Name the tools and versions.')
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Reword "Name the tools." in the "Tech" tone' }))
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled())
  })

  it('asks for the name of your copy of a built-in tone, and goes back to Apply on Cancel', async () => {
    const proposal = rule({ tone_name: 'Professional', built_in: true })
    const { onApply, title } = renderCard(proposal)
    const apply = screen.getByRole('button', { name: `Apply: ${title}` })
    fireEvent.click(apply)
    const form = screen.getByRole('form', { name: `Apply: ${title}` })
    const name = within(form).getByLabelText('Name of your copy')
    await vi.waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveValue('Professional (mine)')
    // What saving does is read with the field.
    expect(name).toHaveAccessibleDescription('"Professional" is built in, so this saves your own copy of it, with the change, for this resume.')
    await expectNoA11yViolations()
    fireEvent.click(within(form).getByRole('button', { name: `Cancel: ${title}` }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: `Apply: ${title}` })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: `Apply: ${title}` }))
    fireEvent.change(screen.getByLabelText('Name of your copy'), { target: { value: 'Professional, my way' } })
    fireEvent.click(within(screen.getByRole('form')).getByRole('button', { name: `Apply: ${title}` }))
    await vi.waitFor(() =>
      expect(onApply).toHaveBeenCalledWith({ apply_to: [], earlier_name: null, copy_name: 'Professional, my way' }),
    )
  })

  it('shows a refusal on the field it names, keeping the form open', async () => {
    const proposal = rule({ tone_name: 'Professional', built_in: true })
    const { onApply, title } = renderCard(proposal)
    onApply.mockRejectedValueOnce(new ApiError('DUPLICATE', 'You already have a tone named that.', 'copy_name', 409))
    fireEvent.click(screen.getByRole('button', { name: `Apply: ${title}` }))
    fireEvent.click(within(screen.getByRole('form')).getByRole('button', { name: `Apply: ${title}` }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You already have a tone named that.')
    const name = screen.getByLabelText('Name of your copy')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(expect.stringContaining('You already have a tone named that.'))
    await expectNoA11yViolations()
  })

  it('asks which others using the tone get it, and the earlier name when some keep it', async () => {
    const { onApply, title } = renderCard(rule(), [OTHER])
    fireEvent.click(screen.getByRole('button', { name: `Apply: ${title}` }))
    const choice = screen.getByRole('group', { name: 'Apply this change to which other resumes and cover letters?' })
    // Focus starts on the first one, read with the question.
    await vi.waitFor(() => expect(within(choice).getByRole('checkbox', { name: 'Cover letter: Acme letter' })).toHaveFocus())
    const earlier = screen.getByLabelText('Name of the earlier version, which the others keep')
    expect(earlier).toHaveValue('Tech (earlier)')
    await expectNoA11yViolations()
    // Every other one checked changes the tone in place, so there's no earlier version to name.
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Cover letter: Acme letter' }))
    expect(screen.queryByLabelText('Name of the earlier version, which the others keep')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('form')).getByRole('button', { name: `Apply: ${title}` }))
    await vi.waitFor(() =>
      expect(onApply).toHaveBeenCalledWith({ apply_to: [{ kind: 'cover_letter', id: 9 }], earlier_name: null, copy_name: null }),
    )
  })

  it('folds away an applied or dismissed card, with Restore for a dismissed one', async () => {
    const { onState, title } = renderCard(rule({ state: 'dismissed' }))
    expect(screen.getByText('dismissed')).toHaveClass('tag')
    expect(screen.queryByRole('button', { name: `Apply: ${title}` })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `Restore: ${title}` }))
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('pending'))
    await expectNoA11yViolations()
  })

  it('is only shown when read-only, and replies go to the chat', async () => {
    renderCard(rule({ target: 'banned', action: 'remove', before: 'synergy' }), [], true)
    expect(screen.getByText('synergy')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
