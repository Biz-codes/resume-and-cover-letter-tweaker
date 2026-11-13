import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe as group, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { TreeSection } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import type { ChatMessage, Proposal } from '../../shared/api/chat'
import { describe } from './describe'
import ProposalCards, { WaitingForYou } from './ProposalCards'

const SECTIONS: TreeSection[] = [{ row_id: 1, section_id: 3, title: 'Experience', entries: [] }]

const base: Proposal = {
  id: 'toolu_1',
  action: 'reword',
  target: 'bullet',
  section_id: 3,
  item_id: 8,
  parent_kind: 'experience',
  parent_id: 7,
  new_text: 'Shipped weekly.',
  position: 0,
  reason: 'Shorter.',
  before: 'Shipped it',
  state: 'pending',
}
const NEW: Proposal = { ...base, id: 'toolu_2', action: 'add', item_id: 0, new_text: 'Mentored two.', before: '', reason: '' }

const message = (...proposals: Proposal[]): ChatMessage => ({
  message_id: 4,
  role: 'assistant',
  text: 'Try these.',
  about: null,
  proposals,
  created_at: null,
})

function renderCards(
  shown: ChatMessage = message(base, NEW),
  readOnly = false,
  onCheck: (messageId: number) => Promise<ChatMessage> = vi.fn(),
) {
  const onApply = vi.fn((_m: number, id: string) =>
    Promise.resolve(message(...(shown.proposals ?? []).map((p) => (p.id === id ? { ...p, state: 'applied' as const } : p)))),
  )
  const onState = vi.fn((_m: number, id: string, state: 'pending' | 'dismissed') =>
    Promise.resolve(message(...(shown.proposals ?? []).map((p) => (p.id === id ? { ...p, state } : p)))),
  )
  const onUpdate = vi.fn()
  const announce = vi.fn()
  const view = render(
    <ProposalCards
      message={shown}
      sections={SECTIONS}
      readOnly={readOnly}
      onApply={onApply}
      onState={onState}
      onCheck={onCheck}
      onUpdate={onUpdate}
      announce={announce}
    />,
  )
  return { onApply, onState, onUpdate, announce, view }
}

const drama = { kind: 'pattern' as const, rule: 'em dashes used for drama', quote: '—', why: 'It adds drama.' }

group('describe', () => {
  it('names each kind of change in a few words', () => {
    expect(describe(base, SECTIONS)).toBe('Reword the bullet "Shipped it" in Experience')
    expect(describe(NEW, SECTIONS)).toBe('Add new bullet in Experience')
    expect(describe({ ...base, action: 'add', target: 'experience', before: 'Engineer, Acme' }, SECTIONS)).toBe(
      'Add the role Engineer, Acme in Experience',
    )
    expect(describe({ ...base, action: 'remove', target: 'skill', before: 'React' }, SECTIONS)).toBe('Remove the skill React in Experience')
    expect(describe({ ...base, action: 'move', target: 'section', before: 'Projects', position: 1 }, SECTIONS)).toBe(
      'Move the Projects section to position 1',
    )
    expect(describe({ ...base, action: 'move', position: 0 }, SECTIONS)).toBe('Move the bullet "Shipped it" in Experience to the end')
    expect(describe({ ...base, section_id: 99 }, SECTIONS)).toBe('Reword the bullet "Shipped it" in a section')
  })

  it('names the category, role, or project a skill or bullet is under', () => {
    const entry = (kind: 'category' | 'experience' | 'project', item_id: number, values: Record<string, string>) => ({
      kind, row_id: item_id, item_id, position: 1, values, skills: [], bullets: [],
    })
    const sections: TreeSection[] = [
      { row_id: 1, section_id: 2, title: 'Skills', entries: [entry('category', 5, { category_name: 'Back End' })] },
      { row_id: 2, section_id: 3, title: 'Experience', entries: [entry('experience', 7, { role_title: 'Engineer', organization: 'Acme' })] },
      { row_id: 3, section_id: 4, title: 'Projects', entries: [entry('project', 9, { project_title: 'Tweaker' })] },
    ]
    const skill = { ...base, action: 'move' as const, target: 'skill' as const, section_id: 2, parent_kind: 'category' as const, parent_id: 5, before: 'Alembic' }
    expect(describe(skill, sections)).toBe('Move the skill Alembic in Back End to the end')
    expect(describe(base, sections)).toBe('Reword the bullet "Shipped it" in Engineer, Acme')
    expect(describe({ ...NEW, section_id: 4, parent_kind: 'project', parent_id: 9 }, sections)).toBe('Add new bullet in Tweaker')
    // Placed directly in a section, or its parent gone: the section.
    expect(describe({ ...base, parent_kind: '', parent_id: 0 }, sections)).toBe('Reword the bullet "Shipped it" in Experience')
    expect(describe({ ...skill, parent_id: 6 }, sections)).toBe('Move the skill Alembic in Skills to the end')
  })
})

group('ProposalCards', () => {
  it('shows each change with its before and after and reason, and Apply and Dismiss named for it', async () => {
    renderCards()
    const [reword, added] = within(screen.getByRole('list', { name: 'Proposed changes' })).getAllByRole('listitem')
    expect(within(reword).getByText('Before').nextElementSibling).toHaveTextContent('Shipped it')
    expect(within(reword).getByText('After').nextElementSibling).toHaveTextContent('Shipped weekly.')
    expect(within(reword).getByText('Shorter.')).toBeInTheDocument()
    expect(within(added).getByText('New text').nextElementSibling).toHaveTextContent('Mentored two.')
    expect(screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' })).toHaveTextContent('Apply')
    expect(screen.getByRole('button', { name: 'Dismiss: Add new bullet in Experience' })).toHaveTextContent('Dismiss')
    await expectNoA11yViolations()
  })

  it('applies a change, announcing it and keeping focus on its card', async () => {
    const { onApply, onUpdate, announce } = renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Applied: Reword the bullet "Shipped it" in Experience.'))
    expect(onApply).toHaveBeenCalledWith(4, 'toolu_1')
    expect(onUpdate.mock.calls[0][0].proposals[0].state).toBe('applied')
    await vi.waitFor(() => expect(document.getElementById('proposal-4-toolu_1')).toHaveFocus())
  })

  it('dismisses a change, and restores it', async () => {
    const { onState, announce, view } = renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Add new bullet in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Dismissed: Add new bullet in Experience.'))
    expect(onState).toHaveBeenCalledWith(4, 'toolu_2', 'dismissed')
    view.rerender(
      <ProposalCards
        message={message(base, { ...NEW, state: 'dismissed' })}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={onState}
        onCheck={vi.fn()}
        onUpdate={vi.fn()}
        announce={announce}
      />,
    )
    const card = document.getElementById('proposal-4-toolu_2')!
    expect(within(card).getByText('dismissed')).toHaveClass('tag')
    await expectNoA11yViolations()
    fireEvent.click(within(card).getByRole('button', { name: 'Restore: Add new bullet in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenLastCalledWith('Restored: Add new bullet in Experience.'))
    expect(onState).toHaveBeenLastCalledWith(4, 'toolu_2', 'pending')
  })

  it('shows why a change failed, and says nothing', async () => {
    const { onApply, announce } = renderCards()
    onApply.mockRejectedValueOnce(new ApiError('VALIDATION_FAILED', "This change doesn't fit the document as it is now.", null, 422))
    const apply = screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' })
    apply.focus()
    fireEvent.click(apply)
    expect(await screen.findByRole('alert')).toHaveTextContent("This change doesn't fit the document as it is now.")
    expect(announce).not.toHaveBeenCalled()
    expect(apply).toHaveFocus()
    await expectNoA11yViolations()
  })

  it('marks an applied change, with nothing left to do and its details folded away', async () => {
    renderCards(message({ ...base, state: 'applied' }))
    expect(screen.getByText('applied')).toHaveClass('tag')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const summary = screen.getByText('Details', { exact: false, selector: 'summary' })
    expect(summary).toHaveTextContent('Details of Reword the bullet "Shipped it" in Experience')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    await expectNoA11yViolations()
    fireEvent.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('After').nextElementSibling).toHaveTextContent('Shipped weekly.')
    await expectNoA11yViolations()
  })

  it("folds away a dismissed change's details, keeping Restore", () => {
    renderCards(message({ ...NEW, state: 'dismissed' }))
    expect(screen.getByText('Details', { exact: false, selector: 'summary' }).closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Restore: Add new bullet in Experience' })).toBeInTheDocument()
  })

  it('has no details to fold away for a change without any', () => {
    renderCards(message({ ...base, action: 'remove', reason: '', state: 'applied' }))
    expect(screen.queryByText('Details', { exact: false, selector: 'summary' })).not.toBeInTheDocument()
  })

  it("only shows a sent document's cards", async () => {
    renderCards(message(base, { ...NEW, state: 'dismissed' }), true)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("names a new skill's name as one", async () => {
    renderCards(message({ ...NEW, target: 'skill', parent_kind: 'category', parent_id: 5, new_text: 'Alembic' }))
    expect(screen.getByText('New skill').nextElementSibling).toHaveTextContent('Alembic')
    expect(screen.getByRole('button', { name: 'Apply: Add new skill in Experience' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows nothing without proposals', () => {
    const { view } = renderCards(message())
    expect(view.container).toBeEmptyDOMElement()
  })
})

group('ProposalCards and the writing rules', () => {
  const SAVED: Proposal = { ...base, id: 'toolu_3', action: 'add', item_id: 9, new_text: '', before: 'Led a team — of five', reason: '' }

  it('badges a card whose text breaks a rule and lists each rule, for Claude’s text and a saved item', async () => {
    renderCards(message({ ...base, flags: [drama], checked: true }, { ...SAVED, flags: [drama], checked: true }, { ...NEW, checked: true }))
    // The cards themselves, not the lists of rules inside them.
    const [reword, saved, added] = Array.from(screen.getByRole('list', { name: 'Proposed changes' }).children) as HTMLElement[]
    expect(within(reword).getByText('Flagged')).toBeInTheDocument()
    // Read apart from the title, not run into it.
    expect(within(reword).getAllByRole('paragraph')[0]).toHaveTextContent('Reword the bullet "Shipped it" in Experience Flagged')
    expect(within(reword).getByRole('list', { name: 'Writing rules Reword the bullet "Shipped it" in Experience breaks' })).toHaveTextContent(
      'em dashes used for drama: “—”. It adds drama.',
    )
    expect(within(saved).getByText('Flagged')).toBeInTheDocument()
    expect(within(saved).getByRole('list', { name: /^Writing rules .* breaks$/ })).toBeInTheDocument()
    expect(within(added).queryByText('Flagged')).not.toBeInTheDocument()
    // Every card was checked, so nothing offers to check again.
    expect(screen.queryByRole('button', { name: 'Check writing rules again' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('keeps the flags with the details once a card is applied', () => {
    renderCards(message({ ...base, flags: [drama], checked: true, state: 'applied' }))
    expect(screen.getByText('Flagged')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /^Writing rules/ })).not.toBeVisible()
  })

  it('says when the check failed, and checks again, announcing what it found and moving focus to the first card', async () => {
    const unchecked = message({ ...base, checked: false }, { ...base, id: 'toolu_4', action: 'remove', checked: true })
    const checked = message({ ...base, checked: true, flags: [drama] }, { ...base, id: 'toolu_4', action: 'remove', checked: true })
    const onCheck = vi.fn(() => Promise.resolve(checked))
    const { onUpdate, announce } = renderCards(unchecked, false, onCheck)
    expect(screen.getByText(/couldn't check this change against your writing rules, so nothing in it is flagged/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Check writing rules again' })
    expect(button).toHaveAccessibleDescription(/couldn't check this change/)
    await expectNoA11yViolations()
    fireEvent.click(button)
    expect(button).toHaveTextContent('Checking…')
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Checked against your writing rules. 1 change breaks a rule, marked Flagged.'))
    expect(onCheck).toHaveBeenCalledWith(4)
    expect(onUpdate).toHaveBeenCalledWith(checked)
    await vi.waitFor(() => expect(document.getElementById('proposal-4-toolu_1')).toHaveFocus())
  })

  it('says when checking again finds nothing, and shows a failure with the button still there', async () => {
    const two = message({ ...base, checked: false }, { ...NEW, checked: false })
    const onCheck = vi
      .fn<(messageId: number) => Promise<ChatMessage>>()
      .mockRejectedValueOnce(new ApiError('AI_UNAVAILABLE', 'Claude is unavailable. Try again.', null, 503))
      .mockResolvedValueOnce(message({ ...base, checked: true }, { ...NEW, checked: true }))
    const { announce } = renderCards(two, false, onCheck)
    expect(screen.getByText(/couldn't check these 2 changes against your writing rules, so nothing in them is flagged/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude is unavailable. Try again.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules again' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Checked against your writing rules. Nothing breaks a rule.'))
  })

  it('shows a sent document’s unchecked note without the button, and leaves out applied cards', () => {
    renderCards(message({ ...base, checked: false }), true)
    expect(screen.getByText(/couldn't check this change/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check writing rules again' })).not.toBeInTheDocument()
  })

  it('has nothing to check again once the unchecked card is applied', () => {
    renderCards(message({ ...base, checked: false, state: 'applied' }))
    expect(screen.queryByText(/couldn't check/)).not.toBeInTheDocument()
  })
})

group('WaitingForYou', () => {
  const later: ChatMessage = { ...message({ ...base, id: 'toolu_3', action: 'remove', target: 'skill', before: 'React' }), message_id: 6 }

  function renderWaiting(messages: ChatMessage[]) {
    return render(
      <>
        <WaitingForYou messages={messages} sections={SECTIONS} />
        {messages.map((shown) => (
          <ProposalCards
            key={shown.message_id}
            message={shown}
            sections={SECTIONS}
            readOnly={false}
            onApply={vi.fn()}
            onState={vi.fn()}
            onCheck={vi.fn()}
            onUpdate={vi.fn()}
            announce={vi.fn()}
          />
        ))}
      </>,
    )
  }

  it('lists every change still waiting, oldest first, leaving out applied and dismissed ones', async () => {
    renderWaiting([message(base, { ...NEW, state: 'applied' }, { ...base, id: 'toolu_4', state: 'dismissed' }), later])
    const list = screen.getByRole('region', { name: 'Waiting for you (2)' })
    expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Reword the bullet "Shipped it" in Experience',
      'Remove the skill React in Experience',
    ])
    await expectNoA11yViolations()
  })

  it('moves focus to the card it names', async () => {
    renderWaiting([message(base), later])
    fireEvent.click(screen.getByRole('button', { name: 'Go to: Remove the skill React in Experience' }))
    await vi.waitFor(() => expect(document.getElementById('proposal-6-toolu_3')).toHaveFocus())
  })

  it('shows nothing when nothing is waiting', () => {
    const { container } = render(<WaitingForYou messages={[message({ ...base, state: 'applied' })]} sections={SECTIONS} />)
    expect(container).toBeEmptyDOMElement()
  })
})
